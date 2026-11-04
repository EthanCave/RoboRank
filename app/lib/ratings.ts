// Pure rating math (no I/O): TrueSkill for 2v2 alliances, per-event OPR/DPR/CCWM, win
// probabilities, and skills personal bests. Inputs are normalized match records so this file can
// be unit-tested without RobotEvents.

export type RatedMatch = {
  id: number;
  eventId: number;
  round: number;
  /** Sort key: ISO time the match started (or was scheduled). */
  time: string | null;
  order: number;
  instance?: number;
  matchnum?: number;
  red: string[];
  blue: string[];
  redScore: number;
  blueScore: number;
};

export type TrueSkillRating = { mu: number; sigma: number };

export type TeamRating = TrueSkillRating & {
  teamNumber: string;
  /** Conservative skill estimate (mu - 3 sigma), the usual TrueSkill leaderboard number. */
  trueskill: number;
  matches: number;
  wins: number;
  losses: number;
  ties: number;
};

export type OprRow = { teamNumber: string; opr: number; dpr: number; ccwm: number; matches: number };

export const ROUND = {
  practice: 1,
  qualification: 2,
} as const;

// TrueSkill defaults (Herbrich et al.). Draws are rare in V5RC but real.
const MU0 = 25;
const SIGMA0 = MU0 / 3;
const BETA = SIGMA0 / 2;
const TAU = SIGMA0 / 100;
const DRAW_PROBABILITY = 0.02;

// ---------------------------------------------------------------------------------------------
// Gaussian helpers

function erfc(x: number) {
  // Numerical Recipes erfcc: fractional error < 1.2e-7 everywhere.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

export function normalCdf(x: number) {
  return 0.5 * erfc(-x / Math.SQRT2);
}

function normalPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalPpf(p: number): number {
  // Acklam's rational approximation; plenty for deriving the draw margin.
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalPpf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function vWin(t: number, e: number) {
  const denom = normalCdf(t - e);
  return denom > 1e-12 ? normalPdf(t - e) / denom : -(t - e);
}

function wWin(t: number, e: number) {
  const v = vWin(t, e);
  return Math.min(Math.max(v * (v + t - e), 0), 1);
}

function vDraw(t: number, e: number) {
  const denom = normalCdf(e - t) - normalCdf(-e - t);
  return denom > 1e-12 ? (normalPdf(-e - t) - normalPdf(e - t)) / denom : t < 0 ? -t - e : -t + e;
}

function wDraw(t: number, e: number) {
  const denom = normalCdf(e - t) - normalCdf(-e - t);
  if (denom <= 1e-12) return 1;
  const v = vDraw(t, e);
  return Math.min(Math.max(v * v + ((e - t) * normalPdf(e - t) + (e + t) * normalPdf(e + t)) / denom, 0), 1);
}

// ---------------------------------------------------------------------------------------------
// TrueSkill

/** Scored, non-practice matches with two full alliances. Unplayed matches report 0-0. */
export function isRateable(match: RatedMatch) {
  return (
    match.round !== ROUND.practice &&
    match.red.length > 0 &&
    match.blue.length > 0 &&
    match.redScore + match.blueScore > 0
  );
}

export function sortMatchesChronologically<T extends RatedMatch>(matches: T[]) {
  return [...matches].sort((a, b) => {
    const left = Date.parse(a.time ?? "") || 0;
    const right = Date.parse(b.time ?? "") || 0;
    return left - right || a.eventId - b.eventId || a.order - b.order || a.id - b.id;
  });
}

function updateTwoTeams(red: TrueSkillRating[], blue: TrueSkillRating[], outcome: "red" | "blue" | "tie") {
  const players = [...red, ...blue];
  for (const player of players) player.sigma = Math.sqrt(player.sigma ** 2 + TAU ** 2);

  const n = players.length;
  const c = Math.sqrt(players.reduce((sum, p) => sum + p.sigma ** 2, 0) + n * BETA ** 2);
  const epsilon = normalPpf((DRAW_PROBABILITY + 1) / 2) * Math.sqrt(n) * BETA;
  const e = epsilon / c;

  const redMu = red.reduce((sum, p) => sum + p.mu, 0);
  const blueMu = blue.reduce((sum, p) => sum + p.mu, 0);

  let winners = red;
  let losers = blue;
  let v: number;
  let w: number;

  if (outcome === "tie") {
    const t = (redMu - blueMu) / c;
    v = vDraw(t, e);
    w = wDraw(t, e);
  } else {
    if (outcome === "blue") {
      winners = blue;
      losers = red;
    }
    const t = (outcome === "red" ? redMu - blueMu : blueMu - redMu) / c;
    v = vWin(t, e);
    w = wWin(t, e);
  }

  for (const p of winners) {
    const s2 = p.sigma ** 2;
    p.mu += (s2 / c) * v;
    p.sigma = Math.sqrt(s2 * Math.max(1 - (s2 / (c * c)) * w, 1e-4));
  }
  for (const p of losers) {
    const s2 = p.sigma ** 2;
    p.mu -= (s2 / c) * v;
    p.sigma = Math.sqrt(s2 * Math.max(1 - (s2 / (c * c)) * w, 1e-4));
  }
}

/** Replays every rateable match in time order and returns one rating per team seen. */
export function computeTrueSkill(matches: RatedMatch[]): Map<string, TeamRating> {
  return replayTrueSkill(matches).ratings;
}

/** A team's conservative TrueSkill after each of its matches, oldest first. */
export function trueSkillHistory(matches: RatedMatch[], teamNumber: string): Array<{ matchId: number; time: string | null; trueskill: number }> {
  return replayTrueSkill(matches, teamNumber).history;
}

function replayTrueSkill(matches: RatedMatch[], track?: string) {
  const history: Array<{ matchId: number; time: string | null; trueskill: number }> = [];
  const ratings = new Map<string, TeamRating>();
  const get = (teamNumber: string) => {
    let rating = ratings.get(teamNumber);
    if (!rating) {
      rating = { teamNumber, mu: MU0, sigma: SIGMA0, trueskill: 0, matches: 0, wins: 0, losses: 0, ties: 0 };
      ratings.set(teamNumber, rating);
    }
    return rating;
  };

  for (const match of sortMatchesChronologically(matches.filter(isRateable))) {
    const red = match.red.map(get);
    const blue = match.blue.map(get);
    const outcome = match.redScore > match.blueScore ? "red" : match.blueScore > match.redScore ? "blue" : "tie";
    updateTwoTeams(red, blue, outcome);

    for (const team of red) {
      team.matches += 1;
      if (outcome === "red") team.wins += 1;
      else if (outcome === "blue") team.losses += 1;
      else team.ties += 1;
    }
    for (const team of blue) {
      team.matches += 1;
      if (outcome === "blue") team.wins += 1;
      else if (outcome === "red") team.losses += 1;
      else team.ties += 1;
    }

    if (track && (match.red.includes(track) || match.blue.includes(track))) {
      const tracked = ratings.get(track)!;
      history.push({ matchId: match.id, time: match.time, trueskill: tracked.mu - 3 * tracked.sigma });
    }
  }

  for (const rating of ratings.values()) rating.trueskill = rating.mu - 3 * rating.sigma;
  return { ratings, history };
}

const DEFAULT_RATING: TrueSkillRating = { mu: MU0, sigma: SIGMA0 };

/** P(red alliance wins) from TrueSkill posteriors; unknown teams use the prior. */
export function winProbability(red: Array<TrueSkillRating | undefined>, blue: Array<TrueSkillRating | undefined>) {
  const r = red.map((entry) => entry ?? DEFAULT_RATING);
  const b = blue.map((entry) => entry ?? DEFAULT_RATING);
  const delta = r.reduce((sum, p) => sum + p.mu, 0) - b.reduce((sum, p) => sum + p.mu, 0);
  const variance = [...r, ...b].reduce((sum, p) => sum + p.sigma ** 2 + BETA ** 2, 0);
  return normalCdf(delta / Math.sqrt(variance));
}

// ---------------------------------------------------------------------------------------------
// OPR / DPR / CCWM

function solveLinearSystem(matrix: number[][], rhs: number[]) {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    if (Math.abs(p) < 1e-12) continue;
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / p;
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    if (Math.abs(a[row][row]) < 1e-12) continue;
    let sum = a[row][n];
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/**
 * Least-squares OPR/DPR over one event's scored qualification matches: each alliance's score is
 * modeled as the sum of its teams' contributions. A tiny ridge term keeps the system solvable when
 * few matches have been played.
 */
export function computeEventOpr(matches: RatedMatch[]): OprRow[] {
  const quals = matches.filter((m) => m.round === ROUND.qualification && isRateable(m));
  const teams = [...new Set(quals.flatMap((m) => [...m.red, ...m.blue]))].sort();
  if (!teams.length) return [];

  const index = new Map(teams.map((team, i) => [team, i]));
  const n = teams.length;
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atbScored = new Array<number>(n).fill(0);
  const atbAllowed = new Array<number>(n).fill(0);
  const played = new Array<number>(n).fill(0);

  const addRow = (alliance: string[], scored: number, allowed: number) => {
    const ids = alliance.map((team) => index.get(team)!);
    for (const i of ids) {
      played[i] += 1;
      atbScored[i] += scored;
      atbAllowed[i] += allowed;
      for (const j of ids) ata[i][j] += 1;
    }
  };

  for (const match of quals) {
    addRow(match.red, match.redScore, match.blueScore);
    addRow(match.blue, match.blueScore, match.redScore);
  }

  for (let i = 0; i < n; i += 1) ata[i][i] += 1e-3;

  const opr = solveLinearSystem(ata, atbScored);
  const dpr = solveLinearSystem(ata, atbAllowed);

  return teams.map((teamNumber, i) => ({
    teamNumber,
    opr: opr[i],
    dpr: dpr[i],
    ccwm: opr[i] - dpr[i],
    matches: played[i],
  }));
}

/** Season OPR per team: event OPRs averaged, weighted by qualification matches played. */
export function computeSeasonOpr(matches: RatedMatch[]): Map<string, OprRow> {
  const byEvent = new Map<number, RatedMatch[]>();
  for (const match of matches) {
    const list = byEvent.get(match.eventId) ?? [];
    list.push(match);
    byEvent.set(match.eventId, list);
  }

  const totals = new Map<string, OprRow>();
  for (const eventMatches of byEvent.values()) {
    for (const row of computeEventOpr(eventMatches)) {
      const total = totals.get(row.teamNumber) ?? { teamNumber: row.teamNumber, opr: 0, dpr: 0, ccwm: 0, matches: 0 };
      total.opr += row.opr * row.matches;
      total.dpr += row.dpr * row.matches;
      total.ccwm += row.ccwm * row.matches;
      total.matches += row.matches;
      totals.set(row.teamNumber, total);
    }
  }

  for (const total of totals.values()) {
    if (total.matches > 0) {
      total.opr /= total.matches;
      total.dpr /= total.matches;
      total.ccwm /= total.matches;
    }
  }
  return totals;
}

// ---------------------------------------------------------------------------------------------
// Skills

export type SkillsRun = { eventId: number; teamNumber: string; type: string; score: number };
export type SkillsBest = { teamNumber: string; eventId: number; driver: number; programming: number; combined: number };

/** Best combined skills (driver + programming from the same event), per team. */
export function computeSkillsBests(runs: SkillsRun[]): Map<string, SkillsBest> {
  const perEvent = new Map<string, SkillsBest>();
  for (const run of runs) {
    if (run.type !== "driver" && run.type !== "programming") continue;
    const key = `${run.teamNumber}|${run.eventId}`;
    const entry = perEvent.get(key) ?? { teamNumber: run.teamNumber, eventId: run.eventId, driver: 0, programming: 0, combined: 0 };
    entry[run.type] = Math.max(entry[run.type], run.score);
    entry.combined = entry.driver + entry.programming;
    perEvent.set(key, entry);
  }

  const best = new Map<string, SkillsBest>();
  for (const entry of perEvent.values()) {
    const current = best.get(entry.teamNumber);
    if (!current || entry.combined > current.combined) best.set(entry.teamNumber, entry);
  }
  return best;
}
