import { getDb } from "./db.server";
import { computeEventOpr, winProbability, type OprRow, type RatedMatch } from "./ratings";
import { loadRatedMatches } from "./season-sync.server";
import { normalizeTeamNumber } from "./teams";

export type TeamStats = {
  teamNumber: string;
  mu: number;
  sigma: number;
  trueskill: number;
  rank: number | null;
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
  opr: number | null;
  dpr: number | null;
  ccwm: number | null;
  skillsBest: number | null;
  skillsDriver: number | null;
  skillsProgramming: number | null;
};

type RatingRow = {
  team_number: string;
  mu: number;
  sigma: number;
  trueskill: number;
  trueskill_rank: number | null;
  matches: number;
  wins: number;
  losses: number;
  ties: number;
  opr: number | null;
  dpr: number | null;
  ccwm: number | null;
  skills_best: number | null;
  skills_driver: number | null;
  skills_programming: number | null;
};

function toStats(row: RatingRow): TeamStats {
  return {
    teamNumber: row.team_number,
    mu: row.mu,
    sigma: row.sigma,
    trueskill: row.trueskill,
    rank: row.trueskill_rank,
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    winRate: row.matches > 0 ? (row.wins + row.ties * 0.5) / row.matches : null,
    opr: row.opr,
    dpr: row.dpr,
    ccwm: row.ccwm,
    skillsBest: row.skills_best,
    skillsDriver: row.skills_driver,
    skillsProgramming: row.skills_programming,
  };
}

export function getTeamStats(teamNumber: string): TeamStats | null {
  const row = getDb().prepare("SELECT * FROM team_ratings WHERE team_number = ?").get(normalizeTeamNumber(teamNumber)) as RatingRow | undefined;
  return row ? toStats(row) : null;
}

export function getStatsForTeams(teamNumbers: string[]): Map<string, TeamStats> {
  const unique = [...new Set(teamNumbers.map(normalizeTeamNumber).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = getDb()
    .prepare(`SELECT * FROM team_ratings WHERE team_number IN (${unique.map(() => "?").join(",")})`)
    .all(...unique) as RatingRow[];
  return new Map(rows.map((row) => [row.team_number, toStats(row)]));
}

export function countRatedTeams() {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM team_ratings WHERE matches > 0").get() as { n: number };
  return row.n;
}

export function topTeams(limit = 25): TeamStats[] {
  const rows = getDb()
    .prepare("SELECT * FROM team_ratings WHERE matches >= 6 ORDER BY trueskill DESC LIMIT ?")
    .all(limit) as RatingRow[];
  return rows.map(toStats);
}

export function searchTeamNumbers(prefix: string, limit = 8): string[] {
  const query = normalizeTeamNumber(prefix).replace(/[%_]/g, "");
  if (query.length < 2) return [];
  const rows = getDb()
    .prepare("SELECT team_number FROM team_ratings WHERE team_number LIKE ? ORDER BY length(team_number), team_number LIMIT ?")
    .all(`${query}%`, limit) as Array<{ team_number: string }>;
  return rows.map((row) => row.team_number);
}

export type IndexedEvent = {
  id: number;
  sku: string;
  name: string;
  start: string | null;
  end: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
};

export function searchEvents(query: string, limit = 8): IndexedEvent[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return getDb()
    .prepare(
      `SELECT id, sku, name, start, end, city, region, country FROM events
       WHERE name LIKE ? OR sku LIKE ? OR city LIKE ? OR region LIKE ?
       ORDER BY abs(julianday(start) - julianday('now')) LIMIT ?`,
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, limit) as IndexedEvent[];
}

/** Teams' current-season match records from the local index, newest first. */
export function getIndexedTeamMatches(teamNumber: string): Array<RatedMatch & { eventName: string; eventSku: string }> {
  const team = normalizeTeamNumber(teamNumber);
  const matches = loadRatedMatches("id IN (SELECT match_id FROM match_teams WHERE team_number = ?)", team);
  const events = new Map(
    (getDb()
      .prepare(`SELECT id, name, sku FROM events WHERE id IN (SELECT DISTINCT event_id FROM matches WHERE id IN (SELECT match_id FROM match_teams WHERE team_number = ?))`)
      .all(team) as Array<{ id: number; name: string; sku: string }>).map((row) => [row.id, row]),
  );
  return matches
    .map((match) => ({ ...match, eventName: events.get(match.eventId)?.name ?? "Event", eventSku: events.get(match.eventId)?.sku ?? "" }))
    .sort((a, b) => (Date.parse(b.time ?? "") || 0) - (Date.parse(a.time ?? "") || 0) || b.order - a.order);
}

export function eventOprFromMatches(matches: RatedMatch[]): Map<string, OprRow> {
  return new Map(computeEventOpr(matches).map((row) => [row.teamNumber, row]));
}

export function predictRedWin(red: string[], blue: string[], stats: Map<string, TeamStats>) {
  return winProbability(
    red.map((team) => stats.get(team)),
    blue.map((team) => stats.get(team)),
  );
}

/** Expected alliance score from season OPR (falls back to the field average). */
export function predictScore(alliance: string[], stats: Map<string, TeamStats>, fallbackOpr: number) {
  return alliance.reduce((sum, team) => sum + (stats.get(team)?.opr ?? fallbackOpr), 0);
}
