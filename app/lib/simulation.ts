// Monte Carlo event simulator (pure; seeded so results are reproducible).
// Each run samples every team's event-day skill from its TrueSkill posterior, plays the remaining
// qualification matches, ranks teams (WP then SP), runs alliance selection, and plays a seeded
// single-elimination bracket.

export type SimTeam = { teamNumber: string; mu: number; sigma: number; opr: number };

export type SimMatch = {
  id: number;
  red: string[];
  blue: string[];
  /** Present when the match has already been played. */
  result?: { redScore: number; blueScore: number };
};

export type Standing = { teamNumber: string; rank: number; wp: number; sp: number; wins: number; losses: number; ties: number };
export type Alliance = { seed: number; teams: string[] };
export type BracketGame = { round: number; redSeed: number | null; blueSeed: number | null; winnerSeed: number | null };

export type TeamOdds = {
  teamNumber: string;
  avgRank: number;
  top4: number;
  captain: number;
  champion: number;
};

export type SimulationResult = {
  seed: number;
  iterations: number;
  usedRealSchedule: boolean;
  playedMatches: number;
  totalMatches: number;
  allianceCount: number;
  odds: TeamOdds[];
  sample: { standings: Standing[]; alliances: Alliance[]; bracket: BracketGame[]; champion: Alliance | null };
};

const BETA = 25 / 6;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function shuffle<T>(items: T[], rand: () => number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Round-robin-ish schedule when the event hasn't published one: everyone plays `perTeam` matches. */
export function generateSchedule(teams: string[], perTeam: number, rand: () => number): SimMatch[] {
  if (teams.length < 4) return [];
  const played = new Map(teams.map((team) => [team, 0]));
  const partners = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const schedule: SimMatch[] = [];

  for (let guard = 0; guard < teams.length * perTeam; guard += 1) {
    const needing = shuffle(teams.filter((team) => played.get(team)! < perTeam), rand).sort((a, b) => played.get(a)! - played.get(b)!);
    if (needing.length < 4) break;

    const pickPartner = (anchor: string, pool: string[]) =>
      [...pool].sort((x, y) => (partners.get(pairKey(anchor, x)) ?? 0) - (partners.get(pairKey(anchor, y)) ?? 0))[0];

    const a = needing[0];
    const b = pickPartner(a, needing.slice(1));
    const rest = needing.filter((team) => team !== a && team !== b);
    const c = rest[0];
    const d = pickPartner(c, rest.slice(1));

    schedule.push({ id: -(schedule.length + 1), red: [a, b], blue: [c, d] });
    for (const team of [a, b, c, d]) played.set(team, played.get(team)! + 1);
    partners.set(pairKey(a, b), (partners.get(pairKey(a, b)) ?? 0) + 1);
    partners.set(pairKey(c, d), (partners.get(pairKey(c, d)) ?? 0) + 1);
  }
  return schedule;
}

/** Standard bracket order, e.g. 8 → [1,8,4,5,2,7,3,6] so seed 1 can only meet seed 2 in the final. */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return order;
}

export function allianceCountFor(teamCount: number) {
  if (teamCount >= 32) return 16;
  return Math.max(2, Math.min(8, Math.floor(teamCount / 2)));
}

type RunState = { skill: Map<string, number>; byTeam: Map<string, SimTeam> };

function performance(teams: string[], state: RunState, rand: () => number) {
  return teams.reduce((sum, team) => sum + (state.skill.get(team) ?? 25) + gaussian(rand) * BETA, 0);
}

function sampleScores(red: string[], blue: string[], redWins: boolean | null, state: RunState, rand: () => number) {
  const expected = (teams: string[]) => teams.reduce((sum, team) => sum + (state.byTeam.get(team)?.opr ?? 0), 0);
  const draw = (teams: string[]) => Math.max(0, Math.round(expected(teams) * (1 + gaussian(rand) * 0.25)));
  let redScore = draw(red);
  let blueScore = draw(blue);
  if (redWins === null) blueScore = redScore;
  else if (redWins !== redScore > blueScore) [redScore, blueScore] = [blueScore, redScore];
  if (redWins !== null && redScore === blueScore) redWins ? (redScore += 1) : (blueScore += 1);
  return { redScore, blueScore };
}

function playQualifications(schedule: SimMatch[], teams: string[], state: RunState, rand: () => number): Standing[] {
  const table = new Map(teams.map((team) => [team, { teamNumber: team, rank: 0, wp: 0, sp: 0, wins: 0, losses: 0, ties: 0 }]));

  for (const match of schedule) {
    let result = match.result;
    if (!result) {
      const diff = performance(match.red, state, rand) - performance(match.blue, state, rand);
      result = sampleScores(match.red, match.blue, diff === 0 ? null : diff > 0, state, rand);
    }
    const { redScore, blueScore } = result;
    const losingScore = Math.min(redScore, blueScore);

    const apply = (alliance: string[], scored: number, allowed: number) => {
      for (const team of alliance) {
        const row = table.get(team);
        if (!row) continue;
        row.sp += losingScore;
        if (scored > allowed) {
          row.wp += 2;
          row.wins += 1;
        } else if (scored < allowed) {
          row.losses += 1;
        } else {
          row.wp += 1;
          row.ties += 1;
        }
      }
    };
    apply(match.red, redScore, blueScore);
    apply(match.blue, blueScore, redScore);
  }

  const tiebreak = new Map(teams.map((team) => [team, rand()]));
  return [...table.values()]
    .sort((a, b) => b.wp - a.wp || b.sp - a.sp || tiebreak.get(a.teamNumber)! - tiebreak.get(b.teamNumber)!)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * Captains pick in seed order, inviting the strongest available team. A team that would be a
 * higher-skill captain itself declines (and can then no longer be picked, per V5RC rules).
 */
export function selectAlliances(standings: Standing[], strength: (team: string) => number, count: number): Alliance[] {
  const available = standings.map((row) => row.teamNumber);
  const declined = new Set<string>();
  const alliances: Alliance[] = [];

  for (let seed = 1; seed <= count && available.length; seed += 1) {
    const captain = available.shift()!;
    const alliance: Alliance = { seed, teams: [captain] };
    const remainingCaptainSlots = count - seed;

    const candidates = available.filter((team) => !declined.has(team)).sort((a, b) => strength(b) - strength(a));
    for (const invitee of candidates) {
      const wouldCaptain = available.indexOf(invitee) < remainingCaptainSlots;
      if (wouldCaptain && strength(invitee) > strength(captain)) {
        declined.add(invitee);
        continue;
      }
      alliance.teams.push(invitee);
      available.splice(available.indexOf(invitee), 1);
      break;
    }
    alliances.push(alliance);
  }
  return alliances;
}

function playBracket(alliances: Alliance[], state: RunState, rand: () => number) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(alliances.length, 2)));
  const bySeed = new Map(alliances.map((alliance) => [alliance.seed, alliance]));
  let current: Array<Alliance | null> = bracketOrder(size).map((seed) => bySeed.get(seed) ?? null);
  const games: BracketGame[] = [];
  let round = 1;

  while (current.length > 1) {
    const next: Array<Alliance | null> = [];
    for (let i = 0; i < current.length; i += 2) {
      const red = current[i];
      const blue = current[i + 1];
      let winner: Alliance | null = red ?? blue ?? null;
      if (red && blue) {
        winner = performance(red.teams, state, rand) >= performance(blue.teams, state, rand) ? red : blue;
      }
      if (red || blue) games.push({ round, redSeed: red?.seed ?? null, blueSeed: blue?.seed ?? null, winnerSeed: winner?.seed ?? null });
      next.push(winner);
    }
    current = next;
    round += 1;
  }
  return { games, champion: current[0] ?? null };
}

export function simulateEvent(input: {
  teams: SimTeam[];
  schedule: SimMatch[];
  iterations?: number;
  seed?: number;
}): SimulationResult | null {
  const teamNumbers = input.teams.map((team) => team.teamNumber);
  if (teamNumbers.length < 4) return null;

  const seed = input.seed ?? 1;
  const iterations = input.iterations ?? 400;
  const rand = mulberry32(seed);
  const byTeam = new Map(input.teams.map((team) => [team.teamNumber, team]));

  const usedRealSchedule = input.schedule.length > 0;
  const schedule = usedRealSchedule ? input.schedule : generateSchedule(teamNumbers, teamNumbers.length >= 40 ? 6 : 8, rand);
  const allianceCount = allianceCountFor(teamNumbers.length);

  const tally = new Map(teamNumbers.map((team) => [team, { rankSum: 0, top4: 0, captain: 0, champion: 0 }]));
  let sample: SimulationResult["sample"] | null = null;

  for (let i = 0; i < iterations; i += 1) {
    const skill = new Map(input.teams.map((team) => [team.teamNumber, team.mu + gaussian(rand) * team.sigma]));
    const state: RunState = { skill, byTeam };

    const standings = playQualifications(schedule, teamNumbers, state, rand);
    const alliances = selectAlliances(standings, (team) => byTeam.get(team)?.mu ?? 25, allianceCount);
    const { games, champion } = playBracket(alliances, state, rand);

    for (const row of standings) {
      const entry = tally.get(row.teamNumber)!;
      entry.rankSum += row.rank;
      if (row.rank <= 4) entry.top4 += 1;
    }
    for (const alliance of alliances) tally.get(alliance.teams[0])!.captain += 1;
    for (const team of champion?.teams ?? []) tally.get(team)!.champion += 1;

    sample ??= { standings, alliances, bracket: games, champion };
  }

  const odds = teamNumbers
    .map((team) => {
      const entry = tally.get(team)!;
      return {
        teamNumber: team,
        avgRank: entry.rankSum / iterations,
        top4: entry.top4 / iterations,
        captain: entry.captain / iterations,
        champion: entry.champion / iterations,
      };
    })
    .sort((a, b) => b.champion - a.champion || a.avgRank - b.avgRank);

  return {
    seed,
    iterations,
    usedRealSchedule,
    playedMatches: schedule.filter((match) => match.result).length,
    totalMatches: schedule.length,
    allianceCount,
    odds,
    sample: sample!,
  };
}
