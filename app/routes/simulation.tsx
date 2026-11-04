import { Form, useLoaderData } from "react-router";

import type { Route } from "./+types/simulation";
import { formatMetric } from "../lib/format";
import { requireUser } from "../lib/auth.server";
import {
  getRobotEventsConfigurationError,
  listRobotEventSkills,
  listRobotEventTeams,
  listRobotEvents,
  type RobotEvent,
  type RobotTeam,
} from "../lib/robotevents.server";
import { getVrcEventRankings, getVrcTeamProfile, readMetricValue, toMetricRows, type VrcMetricRow } from "../lib/vrc-data.server";

type SimulationModel = "deterministic" | "probabilistic";

type LoaderData = {
  eventSearch: string;
  selectedEvent: RobotEvent | null;
  selectedEventId: number | null;
  events: RobotEvent[];
  robotConfigError: string | null;
  simulation: CompetitionSimulation | null;
  simulationError: string | null;
  simulationModel: SimulationModel;
};

type SimTeam = {
  teamNumber: string;
  opr: number;
  trueskill: number;
  recentForm: number;
  strength: number;
  skillsPb: number;
};

type QualMatch = {
  id: number;
  red: [string, string];
  blue: [string, string];
  redScore: number;
  blueScore: number;
  winner: "red" | "blue" | "tie";
};

type TeamStanding = {
  teamNumber: string;
  wp: number;
  sp: number;
  matchesPlayed: number;
  opr: number;
};

type AlliancePickLog = {
  captain: string;
  invited: string;
  accepted: boolean;
  reason: string;
};

type SimAlliance = {
  seed: number;
  captain: string;
  partner: string | null;
  members: string[];
  power: number;
};

type BracketMatch = {
  round: number;
  label: string;
  redSeed: number | null;
  blueSeed: number | null;
  winnerSeed: number | null;
};

type CompetitionSimulation = {
  model: SimulationModel;
  qualMatchesPerTeam: number;
  qualificationMatches: QualMatch[];
  standings: TeamStanding[];
  pickLog: AlliancePickLog[];
  alliances: SimAlliance[];
  bracket: BracketMatch[];
  champion: SimAlliance | null;
  championOdds: Array<{ teamNumber: string; probability: number }>;
  skillsProjection: Array<{ teamNumber: string; skillsPb: number; projected: number; source: "pb" | "estimated" }>;
  predictedSkillsWinner: { teamNumber: string; skillsPb: number; projected: number; source: "pb" | "estimated" } | null;
  iterations: number;
};

function dateWindow() {
  const start = new Date();
  start.setDate(start.getDate() - 5);
  const end = new Date();
  end.setDate(end.getDate() + 120);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function currentSeasonCode(now = new Date()) {
  const month = now.getMonth() + 1;
  const seasonStartYear = month >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return String(seasonStartYear % 100).padStart(2, "0");
}

function isCurrentSeasonV5Event(event: RobotEvent, seasonCode: string) {
  const sku = event.sku?.toUpperCase() ?? "";
  return sku.includes(`V5RC-${seasonCode}-`);
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function teamPower(team: SimTeam) {
  return team.strength;
}

function redWinProbability(redStrength: number, blueStrength: number) {
  return 1 / (1 + Math.exp(-(redStrength - blueStrength) / 10));
}

function createQualificationSchedule(teams: SimTeam[], matchesPerTeam = 6): Array<{ red: [SimTeam, SimTeam]; blue: [SimTeam, SimTeam] }> {
  if (teams.length < 4) return [];

  const target = new Map<string, number>(teams.map((team) => [team.teamNumber, matchesPerTeam]));
  const appearances = new Map<string, number>(teams.map((team) => [team.teamNumber, 0]));
  const partnerCounts = new Map<string, number>();

  const keyFor = (left: string, right: string) => [left, right].sort().join("|");
  const remaining = (teamNumber: string) =>
    (target.get(teamNumber) ?? matchesPerTeam) - (appearances.get(teamNumber) ?? 0);

  const schedule: Array<{ red: [SimTeam, SimTeam]; blue: [SimTeam, SimTeam] }> = [];
  let guard = 0;

  while (guard < 5000) {
    guard += 1;
    const teamsNeedingMatches = teams.filter((team) => remaining(team.teamNumber) > 0);
    if (teamsNeedingMatches.length < 4) break;

    const sorted = shuffled(teamsNeedingMatches).sort(
      (a, b) => remaining(a.teamNumber) - remaining(b.teamNumber),
    );

    const a = sorted[0];
    const pickPartner = (anchor: SimTeam, candidates: SimTeam[]) => {
      return [...candidates].sort((left, right) => {
        const leftPenalty = partnerCounts.get(keyFor(anchor.teamNumber, left.teamNumber)) ?? 0;
        const rightPenalty = partnerCounts.get(keyFor(anchor.teamNumber, right.teamNumber)) ?? 0;
        return leftPenalty - rightPenalty;
      })[0];
    };

    const restAfterA = sorted.filter((team) => team.teamNumber !== a.teamNumber);
    const b = pickPartner(a, restAfterA);
    if (!b) break;

    const rest = restAfterA.filter((team) => team.teamNumber !== b.teamNumber);
    const c = rest[0];
    if (!c) break;
    const d = pickPartner(c, rest.filter((team) => team.teamNumber !== c.teamNumber));
    if (!d) break;

    const red: [SimTeam, SimTeam] = [a, b];
    const blue: [SimTeam, SimTeam] = [c, d];
    schedule.push({ red, blue });

    for (const team of [a, b, c, d]) {
      appearances.set(team.teamNumber, (appearances.get(team.teamNumber) ?? 0) + 1);
    }

    partnerCounts.set(keyFor(a.teamNumber, b.teamNumber), (partnerCounts.get(keyFor(a.teamNumber, b.teamNumber)) ?? 0) + 1);
    partnerCounts.set(keyFor(c.teamNumber, d.teamNumber), (partnerCounts.get(keyFor(c.teamNumber, d.teamNumber)) ?? 0) + 1);
  }

  return schedule;
}

function simulateQualification(
  schedule: Array<{ red: [SimTeam, SimTeam]; blue: [SimTeam, SimTeam] }>,
  model: SimulationModel,
) {
  const standings = new Map<string, TeamStanding>();
  const upsert = (team: SimTeam) => {
    if (!standings.has(team.teamNumber)) {
      standings.set(team.teamNumber, {
        teamNumber: team.teamNumber,
        wp: 0,
        sp: 0,
        matchesPlayed: 0,
        opr: team.opr,
      });
    }
    return standings.get(team.teamNumber)!;
  };

  const matches: QualMatch[] = [];
  let matchId = 1;

  for (const pairing of schedule) {
    const [r1, r2] = pairing.red;
    const [b1, b2] = pairing.blue;
    const redStrength = teamPower(r1) + teamPower(r2);
    const blueStrength = teamPower(b1) + teamPower(b2);
    const winProb = redWinProbability(redStrength, blueStrength);

    const redWins = model === "probabilistic" ? Math.random() < winProb : redStrength >= blueStrength;
    const winner = redStrength === blueStrength ? "tie" : redWins ? "red" : "blue";

    const baseRed = Math.max(2, redStrength * 2.8);
    const baseBlue = Math.max(2, blueStrength * 2.8);
    const variance = model === "probabilistic" ? (Math.random() - 0.5) * 14 : 0;
    const redScore = Math.max(0, Math.round(baseRed + variance));
    const blueScore = Math.max(0, Math.round(baseBlue - variance));

    const redTeams = [upsert(r1), upsert(r2)];
    const blueTeams = [upsert(b1), upsert(b2)];

    for (const standing of [...redTeams, ...blueTeams]) {
      standing.matchesPlayed += 1;
    }

    if (winner === "red") {
      for (const standing of redTeams) {
        standing.wp += 2;
        standing.sp += blueScore;
      }
      for (const standing of blueTeams) {
        standing.sp += blueScore;
      }
    } else if (winner === "blue") {
      for (const standing of blueTeams) {
        standing.wp += 2;
        standing.sp += redScore;
      }
      for (const standing of redTeams) {
        standing.sp += redScore;
      }
    } else {
      for (const standing of redTeams) {
        standing.wp += 1;
        standing.sp += redScore;
      }
      for (const standing of blueTeams) {
        standing.wp += 1;
        standing.sp += blueScore;
      }
    }

    matches.push({
      id: matchId,
      red: [r1.teamNumber, r2.teamNumber],
      blue: [b1.teamNumber, b2.teamNumber],
      redScore,
      blueScore,
      winner,
    });
    matchId += 1;
  }

  const sortedStandings = [...standings.values()].sort((a, b) => {
    return b.wp - a.wp || b.sp - a.sp || b.opr - a.opr || a.teamNumber.localeCompare(b.teamNumber);
  });

  return { matches, standings: sortedStandings };
}

function shouldAcceptInvite(
  invited: TeamStanding,
  captain: TeamStanding,
  captainPool: Set<string>,
  available: Set<string>,
  declined: Set<string>,
  rankingByTeam: Map<string, TeamStanding>,
) {
  if (!captainPool.has(invited.teamNumber)) {
    return { accepted: true, reason: "Not a captain candidate, accepts invitation." };
  }

  const invitedAlliancePower = invited.opr + captain.opr;
  const bestPotentialPartner = [...available]
    .filter((teamNumber) => teamNumber !== invited.teamNumber && !declined.has(teamNumber))
    .map((teamNumber) => rankingByTeam.get(teamNumber))
    .filter((team): team is TeamStanding => Boolean(team))
    .sort((a, b) => b.opr - a.opr)[0];

  const asCaptainPower = invited.opr + (bestPotentialPartner?.opr ?? 0);
  if (asCaptainPower > invitedAlliancePower * 1.03) {
    return { accepted: false, reason: "Declines to remain available as an alliance captain." };
  }

  return { accepted: true, reason: "Accepts based on stronger projected alliance." };
}

function simulateAllianceSelection(standings: TeamStanding[], numAlliances: number) {
  const rankingByTeam = new Map(standings.map((entry) => [entry.teamNumber, entry]));
  const available = new Set(standings.map((entry) => entry.teamNumber));
  const declined = new Set<string>();
  const captainPool = new Set(standings.slice(0, numAlliances).map((entry) => entry.teamNumber));
  const alliances: SimAlliance[] = [];
  const pickLog: AlliancePickLog[] = [];

  for (let seed = 1; seed <= numAlliances; seed += 1) {
    const captain = standings.find((entry) => available.has(entry.teamNumber));
    if (!captain) break;
    available.delete(captain.teamNumber);

    const alliance: SimAlliance = {
      seed,
      captain: captain.teamNumber,
      partner: null,
      members: [captain.teamNumber],
      power: captain.opr,
    };

    while (true) {
      const candidates = standings.filter(
        (entry) => available.has(entry.teamNumber) && !declined.has(entry.teamNumber),
      );
      if (!candidates.length) break;

      const invited = candidates.sort((a, b) => b.opr - a.opr)[0];
      const decision = shouldAcceptInvite(invited, captain, captainPool, available, declined, rankingByTeam);

      pickLog.push({
        captain: captain.teamNumber,
        invited: invited.teamNumber,
        accepted: decision.accepted,
        reason: decision.reason,
      });

      if (decision.accepted) {
        alliance.partner = invited.teamNumber;
        alliance.members.push(invited.teamNumber);
        available.delete(invited.teamNumber);
        alliance.power = captain.opr + invited.opr;
        break;
      }

      declined.add(invited.teamNumber);
    }

    alliances.push(alliance);
  }

  return { alliances, pickLog };
}

function simulateBracket(alliances: SimAlliance[], model: SimulationModel) {
  if (!alliances.length) return { bracket: [] as BracketMatch[], champion: null as SimAlliance | null };

  const seeded = [...alliances].sort((a, b) => a.seed - b.seed);
  const bracket: BracketMatch[] = [];
  let round = 1;
  let current = seeded;

  while (current.length > 1) {
    const nextRound: SimAlliance[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const red = current[i] ?? null;
      const blue = current[i + 1] ?? null;

      let winner: SimAlliance | null = null;
      if (red && !blue) winner = red;
      else if (!red && blue) winner = blue;
      else if (red && blue) {
        if (model === "probabilistic") {
          const p = redWinProbability(red.power, blue.power);
          winner = Math.random() < p ? red : blue;
        } else {
          winner = red.power >= blue.power ? red : blue;
        }
      }

      bracket.push({
        round,
        label: `R${round} M${Math.floor(i / 2) + 1}`,
        redSeed: red?.seed ?? null,
        blueSeed: blue?.seed ?? null,
        winnerSeed: winner?.seed ?? null,
      });

      if (winner) nextRound.push(winner);
    }

    current = nextRound;
    round += 1;
  }

  return {
    bracket,
    champion: current[0] ?? null,
  };
}

function extractSkillsPersonalBest(payload: unknown): number | null {
  const direct = readMetricValue(payload, [
    "skills",
    "skills_score",
    "combined_skills",
    "personal_best_skills",
    "max_skills",
    "driver_skills",
    "programming_skills",
  ]);
  if (direct !== null) return direct;

  if (!payload || typeof payload !== "object") return null;
  const nested = (payload as Record<string, unknown>).skills;
  if (nested && typeof nested === "object") {
    const driver = readMetricValue(nested, ["driver", "driver_score"]);
    const programming = readMetricValue(nested, ["programming", "programming_score"]);
    if (driver !== null || programming !== null) {
      return (driver ?? 0) + (programming ?? 0);
    }
  }

  if (!payload || typeof payload !== "object") return null;

  const combinedKeys = new Set([
    "combined_score",
    "combinedskills",
    "combined_skills",
    "skills",
    "skills_score",
    "max_skills",
    "personal_best_skills",
  ]);
  const driverKeys = new Set(["driver", "driver_score", "driver_skills"]);
  const programmingKeys = new Set(["programming", "programming_score", "programming_skills"]);

  const collectByKeys = (value: unknown, keys: Set<string>, depth = 0, out: number[] = []): number[] => {
    if (depth > 5 || value === null || value === undefined) return out;
    if (Array.isArray(value)) {
      for (const entry of value) collectByKeys(entry, keys, depth + 1, out);
      return out;
    }
    if (typeof value !== "object") return out;

    const record = value as Record<string, unknown>;
    for (const [key, raw] of Object.entries(record)) {
      if (keys.has(key.toLowerCase())) {
        if (typeof raw === "number" && Number.isFinite(raw)) out.push(raw);
        if (typeof raw === "string" && raw.trim()) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) out.push(parsed);
        }
      }
      collectByKeys(raw, keys, depth + 1, out);
    }

    return out;
  };

  const combined = collectByKeys(payload, combinedKeys).filter((n) => n > 0 && n < 600);
  const driver = collectByKeys(payload, driverKeys).filter((n) => n > 0 && n < 600);
  const programming = collectByKeys(payload, programmingKeys).filter((n) => n > 0 && n < 600);

  const maxCombined = combined.length ? Math.max(...combined) : 0;
  const maxDriver = driver.length ? Math.max(...driver) : 0;
  const maxProgramming = programming.length ? Math.max(...programming) : 0;
  const summed = maxDriver + maxProgramming;

  const best = Math.max(maxCombined, summed);
  return best > 0 ? best : null;
}

function readDeepNumber(payload: unknown, metricKeys: Set<string>, depth = 0): number | null {
  if (depth > 4 || payload === null || payload === undefined) return null;

  if (typeof payload === "number" && Number.isFinite(payload)) return payload;

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const value = readDeepNumber(entry, metricKeys, depth + 1);
      if (value !== null) return value;
    }
    return null;
  }

  if (typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (metricKeys.has(key.toLowerCase())) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }

  for (const value of Object.values(record)) {
    const nested = readDeepNumber(value, metricKeys, depth + 1);
    if (nested !== null) return nested;
  }

  return null;
}

function readTeamNumberFromSkillRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const direct = record.team_number;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim().toUpperCase();
  }

  const nestedTeam = record.team;
  if (nestedTeam && typeof nestedTeam === "object") {
    const number = (nestedTeam as Record<string, unknown>).number;
    if (typeof number === "string" && number.trim()) {
      return number.trim().toUpperCase();
    }
  }

  return null;
}

async function buildEventSkillsPbMap(eventId: number): Promise<Map<string, number>> {
  const rows = await listRobotEventSkills(eventId).catch(() => []);
  const byTeam = new Map<string, number>();
  if (!rows.length) return byTeam;

  const metricKeys = new Set([
    "score",
    "combined_score",
    "combinedskills",
    "combined_skills",
    "skills",
    "skills_score",
    "max_skills",
    "driver",
    "driver_score",
    "programming",
    "programming_score",
  ]);

  for (const row of rows) {
    const teamNumber = readTeamNumberFromSkillRow(row);
    if (!teamNumber) continue;

    const combined = readDeepNumber(row, metricKeys);
    if (combined === null || combined <= 0) continue;

    const current = byTeam.get(teamNumber) ?? 0;
    if (combined > current) {
      byTeam.set(teamNumber, combined);
    }
  }

  return byTeam;
}

async function buildFallbackRankingRows(eventId: number, limit = 40): Promise<VrcMetricRow[]> {
  const teams = await listRobotEventTeams(eventId).catch(() => [] as RobotTeam[]);
  if (!teams.length) return [];

  const uniqueTeamNumbers = Array.from(
    new Set(
      teams
        .map((team) => team.number?.toUpperCase())
        .filter((teamNumber): teamNumber is string => Boolean(teamNumber)),
    ),
  ).slice(0, limit);

  const rows = await Promise.all(
    uniqueTeamNumbers.map(async (teamNumber) => {
      const payload = await getVrcTeamProfile(teamNumber).catch(() => null);
      if (!payload) return null;

      const trueskill = readMetricValue(payload, ["trueskill", "trueSkill", "trueskill_mu", "mu", "ts"]);
      const opr = readMetricValue(payload, ["opr", "OPR"]);
      const awp = readMetricValue(payload, ["awp", "AWP", "auton_win_pct"]);

      if (trueskill === null && opr === null && awp === null) return null;

      return {
        teamNumber,
        rank: null,
        trueskill,
        opr,
        awp,
        raw: {},
      } as VrcMetricRow;
    }),
  );

  return rows.filter((row): row is VrcMetricRow => row !== null);
}

async function simulateCompetition(
  eventId: number,
  standings: VrcMetricRow[],
  skillsPbByTeam: Map<string, number>,
  model: SimulationModel,
): Promise<CompetitionSimulation | null> {
  const eventTeams = await listRobotEventTeams(eventId).catch(() => [] as RobotTeam[]);
  if (eventTeams.length < 4) return null;

  const standingsMap = new Map(standings.map((row) => [row.teamNumber.toUpperCase(), row]));
  const uniqueTeamNumbers = Array.from(
    new Set(
      eventTeams
        .map((team) => team.number?.toUpperCase())
        .filter((teamNumber): teamNumber is string => Boolean(teamNumber)),
    ),
  ).slice(0, 36);

  const teams: SimTeam[] = await Promise.all(
    uniqueTeamNumbers.map(async (teamNumber) => {
      const fromEvent = standingsMap.get(teamNumber);
      const payload = await getVrcTeamProfile(teamNumber).catch(() => null);
      const oprFromProfile = payload ? readMetricValue(payload, ["opr", "OPR"]) : null;
      const tsFromProfile = payload ? readMetricValue(payload, ["trueskill", "trueSkill", "trueskill_mu", "mu", "ts"]) : null;
      const awpFromProfile = payload ? readMetricValue(payload, ["awp", "AWP", "auton_win_pct"]) : null;
      const skillsPb = skillsPbByTeam.get(teamNumber) ?? extractSkillsPersonalBest(payload) ?? 0;
      const opr = fromEvent?.opr ?? oprFromProfile ?? 12;
      const trueskill = fromEvent?.trueskill ?? tsFromProfile ?? 20;
      const recentForm = (fromEvent?.awp ?? awpFromProfile ?? 0.5) * 100;
      const strength = trueskill * 0.7 + opr * 0.25 + recentForm * 0.05;
      return { teamNumber, opr, trueskill, recentForm, strength, skillsPb };
    }),
  );

  const skillsProjection = [...teams]
    .map((team) => ({
      teamNumber: team.teamNumber,
      skillsPb: team.skillsPb,
      projected:
        team.skillsPb > 0
          ? Math.max(team.skillsPb, Math.round(team.skillsPb * 1.03))
          : Math.max(0, Math.round(team.opr * 2.2 + team.trueskill * 0.8)),
      source: team.skillsPb > 0 ? ("pb" as const) : ("estimated" as const),
    }))
    .sort((a, b) => b.projected - a.projected || b.skillsPb - a.skillsPb || a.teamNumber.localeCompare(b.teamNumber))
    .slice(0, 12);

  const qualMatchesPerTeam = 6;
  const schedule = createQualificationSchedule(teams, qualMatchesPerTeam);

  const runOne = () => {
    const qualification = simulateQualification(schedule, model);
    const numAlliances = Math.min(8, Math.max(2, Math.floor(qualification.standings.length / 2)));
    const allianceSelection = simulateAllianceSelection(qualification.standings, numAlliances);
    const elimination = simulateBracket(allianceSelection.alliances, model);
    return { qualification, allianceSelection, elimination };
  };

  const iterations = model === "probabilistic" ? 300 : 1;
  const championCounts = new Map<string, number>();
  let representative: ReturnType<typeof runOne> | null = null;

  for (let i = 0; i < iterations; i += 1) {
    const run = runOne();
    if (!representative) representative = run;

    const champion = run.elimination.champion;
    if (champion) {
      for (const member of champion.members) {
        championCounts.set(member, (championCounts.get(member) ?? 0) + 1);
      }
    }
  }

  if (!representative) return null;

  const championOdds = [...championCounts.entries()]
    .map(([teamNumber, count]) => ({ teamNumber, probability: count / iterations }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 10);

  return {
    model,
    qualMatchesPerTeam,
    qualificationMatches: representative.qualification.matches,
    standings: representative.qualification.standings,
    pickLog: representative.allianceSelection.pickLog,
    alliances: representative.allianceSelection.alliances,
    bracket: representative.elimination.bracket,
    champion: representative.elimination.champion,
    championOdds,
    skillsProjection,
    predictedSkillsWinner: skillsProjection[0] ?? null,
    iterations,
  } satisfies CompetitionSimulation;
}

export function meta(_: Route.MetaArgs) {
  return [{ title: "RoboRank | Simulation" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  const url = new URL(request.url);
  const eventSearch = url.searchParams.get("eventSearch")?.trim() ?? "";
  const selectedEventId = Number(url.searchParams.get("eventId") ?? "") || null;
  const simulationModelParam = url.searchParams.get("simModel");
  const simulationModel: SimulationModel =
    simulationModelParam === "deterministic" ? "deterministic" : "probabilistic";

  const robotConfigError = getRobotEventsConfigurationError();
  let events: RobotEvent[] = [];

  if (!robotConfigError) {
    try {
      const window = dateWindow();
      const seasonCode = currentSeasonCode();
      events = await listRobotEvents({
        search: eventSearch,
        startDate: window.startDate,
        endDate: window.endDate,
        limit: 40,
      });
      events = events.filter((event) => isCurrentSeasonV5Event(event, seasonCode));
    } catch {
      events = [];
    }
  }

  const selectedEvent =
    events.find((entry) => entry.id === selectedEventId) ??
    (selectedEventId ? null : events[0] ?? null);

  let simulation: CompetitionSimulation | null = null;
  let simulationError: string | null = null;

  if (selectedEvent?.id) {
    try {
      const eventRankingsPayload = selectedEvent.sku ? await getVrcEventRankings(selectedEvent.sku) : null;
      let rankingRows = toMetricRows(eventRankingsPayload)
        .sort((a, b) => (b.trueskill ?? 0) - (a.trueskill ?? 0))
        .slice(0, 40);

      if (!rankingRows.length) {
        rankingRows = await buildFallbackRankingRows(selectedEvent.id, 40);
      }

      const eventSkillsPbMap = await buildEventSkillsPbMap(selectedEvent.id);
      simulation = await simulateCompetition(selectedEvent.id, rankingRows, eventSkillsPbMap, simulationModel);
      if (!simulation) {
        simulationError = "Not enough teams to simulate this event.";
      }
    } catch {
      simulationError = "Simulation failed for this event.";
    }
  }

  return {
    eventSearch,
    selectedEvent,
    selectedEventId: selectedEvent?.id ?? null,
    events,
    robotConfigError,
    simulation,
    simulationError,
    simulationModel,
  } satisfies LoaderData;
}

export default function SimulationPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;

  return (
    <section className="page-grid single-column">
      <article className="panel">
        <header className="panel-head between">
          <div>
            <p className="eyebrow">Competition Simulation</p>
            <h2>{data.selectedEvent?.name ?? "Select an event"}</h2>
          </div>

          <Form method="get" className="inline-search wide">
            <input type="search" name="eventSearch" defaultValue={data.eventSearch} placeholder="Filter events" />
            <select name="simModel" defaultValue={data.simulationModel}>
              <option value="probabilistic">Probabilistic TrueSkill</option>
              <option value="deterministic">Deterministic OPR</option>
            </select>
            <button type="submit" className="btn-primary compact">
              Refresh
            </button>
          </Form>
        </header>

        <div className="events-scroll">
          {data.events.map((event) => (
            <Form method="get" key={event.id}>
              <input type="hidden" name="eventSearch" value={data.eventSearch} />
              <input type="hidden" name="simModel" value={data.simulationModel} />
              <input type="hidden" name="eventId" value={event.id} />
              <button type="submit" className={event.id === data.selectedEventId ? "event-pill selected" : "event-pill"}>
                <strong>{event.sku}</strong>
                <span>{event.name}</span>
              </button>
            </Form>
          ))}
        </div>
      </article>

      {data.robotConfigError ? <p className="notice">{data.robotConfigError}</p> : null}
      {data.simulationError ? <p className="notice">{data.simulationError}</p> : null}

      {data.simulation ? (
        <>
          <article className="panel">
            <header>
              <p className="eyebrow">Summary</p>
              <h3>{data.simulation.model === "probabilistic" ? "Probabilistic model" : "Deterministic model"}</h3>
            </header>
            <div className="metric-grid">
              <div>
                <p>Simulation runs</p>
                <strong>{data.simulation.iterations}</strong>
              </div>
              <div>
                <p>Champion</p>
                <strong>{data.simulation.champion ? data.simulation.champion.members.join(" + ") : "-"}</strong>
              </div>
              <div>
                <p>Predicted skills winner</p>
                <strong>
                  {data.simulation.predictedSkillsWinner?.teamNumber ?? "-"}
                  {data.simulation.predictedSkillsWinner?.source === "estimated" ? " (estimated)" : ""}
                </strong>
              </div>
              <div>
                <p>Projected winning skills score</p>
                <strong>{formatMetric(data.simulation.predictedSkillsWinner?.projected ?? null, 0)}</strong>
              </div>
            </div>
          </article>

          <div className="page-grid two-column">
            <article className="panel">
              <h4 className="subheading">Champion odds</h4>
              <ul className="list-block dense list-scroll">
                {data.simulation.championOdds.map((row) => (
                  <li key={`sim-odds-${row.teamNumber}`}>
                    <strong>{row.teamNumber}</strong>
                    <span>{(row.probability * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="panel">
              <h4 className="subheading">Skills PB winner projection</h4>
              <ul className="list-block dense list-scroll">
                {data.simulation.skillsProjection.map((row, index) => (
                  <li key={`sim-skills-${row.teamNumber}`}>
                    <strong>#{index + 1} {row.teamNumber}</strong>
                    <span>
                      {row.source === "pb"
                        ? `Skills PB ${formatMetric(row.skillsPb, 0)}`
                        : "No PB reported • Estimated from OPR/TrueSkill"}{" "}
                      • Projected {formatMetric(row.projected, 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <article className="panel">
            <h4 className="subheading">Elimination bracket</h4>
            <ul className="list-block dense">
              {data.simulation.bracket.map((match) => (
                <li key={`sim-bracket-${match.label}`}>
                  <strong>{match.label}</strong>
                  <span>{match.redSeed ? `Seed ${match.redSeed}` : "Bye"} vs {match.blueSeed ? `Seed ${match.blueSeed}` : "Bye"} {"->"} Winner {match.winnerSeed ? `Seed ${match.winnerSeed}` : "-"}</span>
                </li>
              ))}
            </ul>
          </article>
        </>
      ) : null}
    </section>
  );
}
