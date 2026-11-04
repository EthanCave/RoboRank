import { getDb, getMeta, setMeta, transaction } from "./db.server";
import {
  computeSeasonOpr,
  computeSkillsBests,
  computeTrueSkill,
  type RatedMatch,
  type SkillsRun,
} from "./ratings";
import {
  getActiveSeasonId,
  getRobotEventsConfigurationError,
  listDivisionMatches,
  listRobotEventSkills,
  listSeasonEvents,
  type RobotEvent,
  type RobotMatch,
} from "./robotevents.server";
import { allianceScore, allianceTeams, normalizeTeamNumber } from "./teams";

// Keeps a local index of the active season (events, scored matches, skills runs) so ratings can
// be computed for every team without a third-party analytics API. A full first sync is a few
// hundred rate-limited requests; later syncs only revisit events that are recent or still running.

const RESYNC_INTERVAL_MS = 1000 * 60 * 15;
const EVENT_LIST_INTERVAL_MS = 1000 * 60 * 60 * 6;
const RECENT_EVENT_DAYS = 3;
const RECOMPUTE_EVERY_EVENTS = 25;

export type SyncStatus = {
  state: "idle" | "syncing" | "error" | "disabled";
  lastSyncedAt: string | null;
  processed: number;
  queued: number;
  message: string | null;
};

type SyncGlobal = typeof globalThis & { __roborankSync?: { running: Promise<void> | null; status: SyncStatus } };

function syncState() {
  const g = globalThis as SyncGlobal;
  g.__roborankSync ??= {
    running: null,
    status: { state: "idle", lastSyncedAt: null, processed: 0, queued: 0, message: null },
  };
  return g.__roborankSync;
}

export function getSyncStatus(): SyncStatus {
  const status = syncState().status;
  return { ...status, lastSyncedAt: status.lastSyncedAt ?? getMeta("last_synced_at") };
}

/** Starts a background sync when the index is stale. Never throws and never blocks the caller. */
export function ensureSeasonSync() {
  const state = syncState();
  if (state.running) return;
  if (getRobotEventsConfigurationError()) {
    state.status.state = "disabled";
    return;
  }

  const last = Date.parse(getMeta("last_synced_at") ?? "") || 0;
  if (Date.now() - last < RESYNC_INTERVAL_MS) return;

  state.running = runSync()
    .catch((error: unknown) => {
      state.status.state = "error";
      state.status.message = error instanceof Error ? error.message : "Sync failed.";
    })
    .finally(() => {
      state.running = null;
    });
}

function upsertEvents(events: RobotEvent[], seasonId: number) {
  transaction((db) => {
    const statement = db.prepare(
      `INSERT INTO events (id, sku, name, start, end, season_id, city, region, country, divisions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, name = excluded.name, start = excluded.start, end = excluded.end,
         season_id = excluded.season_id, city = excluded.city, region = excluded.region, country = excluded.country,
         divisions = excluded.divisions`,
    );
    for (const event of events) {
      statement.run(
        event.id,
        event.sku,
        event.name,
        event.start ?? null,
        event.end ?? null,
        seasonId,
        event.location?.city ?? null,
        event.location?.region ?? null,
        event.location?.country ?? null,
        JSON.stringify(event.divisions ?? []),
      );
    }
  });
}

type EventRow = { id: number; start: string | null; end: string | null; divisions: string; complete: number };

function eventsNeedingSync(now: number): EventRow[] {
  const rows = getDb()
    .prepare("SELECT id, start, end, divisions, complete FROM events WHERE complete = 0 AND start IS NOT NULL ORDER BY start")
    .all() as EventRow[];
  return rows.filter((row) => (Date.parse(row.start ?? "") || Infinity) <= now);
}

/** Pulls one event's matches and skills from RobotEvents and replaces the local copy. */
export async function syncEvent(eventId: number, divisionsJson: string, endIso: string | null) {
  const divisions = (JSON.parse(divisionsJson) as Array<{ id: number }>).filter((d) => typeof d.id === "number");
  const divisionIds = divisions.length ? divisions.map((d) => d.id) : [1];

  const matchesByDivision: Array<{ divisionId: number; matches: RobotMatch[] }> = [];
  for (const divisionId of divisionIds) {
    // Let failures (e.g. rate limits) propagate: the event then stays unsynced and is retried,
    // instead of being stored as having no matches.
    matchesByDivision.push({ divisionId, matches: await listDivisionMatches(eventId, divisionId) });
  }
  const skills = await listRobotEventSkills(eventId);

  const end = Date.parse(endIso ?? "") || 0;
  const finished = end > 0 && Date.now() - end > RECENT_EVENT_DAYS * 24 * 60 * 60 * 1000;

  transaction((db) => {
    db.prepare("DELETE FROM match_teams WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)").run(eventId);
    db.prepare("DELETE FROM matches WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM skills WHERE event_id = ?").run(eventId);

    const insertMatch = db.prepare(
      `INSERT OR REPLACE INTO matches (id, event_id, division_id, round, instance, matchnum, name, time, red, blue, red_score, blue_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertTeam = db.prepare("INSERT OR REPLACE INTO match_teams (match_id, team_number, color) VALUES (?, ?, ?)");

    for (const { divisionId, matches } of matchesByDivision) {
      for (const match of matches) {
        const red = allianceTeams(match, "red");
        const blue = allianceTeams(match, "blue");
        if (!red.length || !blue.length) continue;
        insertMatch.run(
          match.id,
          eventId,
          divisionId,
          match.round ?? 0,
          match.instance ?? 0,
          match.matchnum ?? 0,
          match.name ?? null,
          match.started ?? match.scheduled ?? null,
          red.join(","),
          blue.join(","),
          allianceScore(match, "red") ?? 0,
          allianceScore(match, "blue") ?? 0,
        );
        for (const team of red) insertTeam.run(match.id, team, "red");
        for (const team of blue) insertTeam.run(match.id, team, "blue");
      }
    }

    const insertSkill = db.prepare(
      `INSERT INTO skills (event_id, team_number, type, score) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, team_number, type) DO UPDATE SET score = MAX(score, excluded.score)`,
    );
    for (const row of skills) {
      const team = normalizeTeamNumber(row.team?.name);
      if (!team || typeof row.score !== "number" || !row.type) continue;
      insertSkill.run(eventId, team, row.type, row.score);
    }

    db.prepare("UPDATE events SET synced_at = ?, complete = ? WHERE id = ?").run(new Date().toISOString(), finished ? 1 : 0, eventId);
  });
}

type MatchRow = {
  id: number;
  event_id: number;
  round: number;
  instance: number;
  matchnum: number;
  time: string | null;
  red: string;
  blue: string;
  red_score: number;
  blue_score: number;
};

export function loadRatedMatches(where = "1 = 1", ...params: Array<string | number>): RatedMatch[] {
  const rows = getDb()
    .prepare(`SELECT id, event_id, round, instance, matchnum, time, red, blue, red_score, blue_score FROM matches WHERE ${where}`)
    .all(...params) as MatchRow[];
  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    round: row.round,
    time: row.time,
    order: row.round * 100000 + row.instance * 1000 + row.matchnum,
    instance: row.instance,
    matchnum: row.matchnum,
    red: row.red.split(",").filter(Boolean),
    blue: row.blue.split(",").filter(Boolean),
    redScore: row.red_score,
    blueScore: row.blue_score,
  }));
}

/** Recomputes every team's season rating from the local index (milliseconds, even late season). */
export function recomputeRatings() {
  const matches = loadRatedMatches();
  const trueskill = computeTrueSkill(matches);
  const opr = computeSeasonOpr(matches);
  const skillsRuns = getDb().prepare("SELECT event_id AS eventId, team_number AS teamNumber, type, score FROM skills").all() as SkillsRun[];
  const skills = computeSkillsBests(skillsRuns);

  const teams = new Set([...trueskill.keys(), ...skills.keys()]);
  const ranked = [...trueskill.values()].sort((a, b) => b.trueskill - a.trueskill);
  const rankByTeam = new Map(ranked.map((rating, index) => [rating.teamNumber, index + 1]));

  transaction((db) => {
    db.exec("DELETE FROM team_ratings");
    const insert = db.prepare(
      `INSERT INTO team_ratings (team_number, mu, sigma, trueskill, matches, wins, losses, ties, opr, dpr, ccwm,
         skills_best, skills_driver, skills_programming, trueskill_rank)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const team of teams) {
      const ts = trueskill.get(team);
      const o = opr.get(team);
      const s = skills.get(team);
      insert.run(
        team,
        ts?.mu ?? 25,
        ts?.sigma ?? 25 / 3,
        ts?.trueskill ?? 0,
        ts?.matches ?? 0,
        ts?.wins ?? 0,
        ts?.losses ?? 0,
        ts?.ties ?? 0,
        o?.opr ?? null,
        o?.dpr ?? null,
        o?.ccwm ?? null,
        s?.combined ?? null,
        s?.driver ?? null,
        s?.programming ?? null,
        rankByTeam.get(team) ?? null,
      );
    }
  });
}

async function runSync() {
  const state = syncState();
  state.status = { ...state.status, state: "syncing", processed: 0, queued: 0, message: "Loading season events…" };

  const seasonId = await getActiveSeasonId();
  if (!seasonId) throw new Error("No active V5RC season found on RobotEvents.");

  if (Number(getMeta("season_id")) !== seasonId) {
    // New season: start the index fresh (notes are kept).
    transaction((db) => db.exec("DELETE FROM match_teams; DELETE FROM matches; DELETE FROM skills; DELETE FROM events; DELETE FROM team_ratings;"));
    setMeta("season_id", String(seasonId));
    setMeta("events_listed_at", "");
  }

  const listedAt = Date.parse(getMeta("events_listed_at") ?? "") || 0;
  if (Date.now() - listedAt > EVENT_LIST_INTERVAL_MS) {
    upsertEvents(await listSeasonEvents(seasonId), seasonId);
    setMeta("events_listed_at", new Date().toISOString());
  }

  const pending = eventsNeedingSync(Date.now());
  state.status.queued = pending.length;
  state.status.message = pending.length ? `Syncing ${pending.length} events…` : null;

  for (const [index, event] of pending.entries()) {
    await syncEvent(event.id, event.divisions, event.end);
    state.status.processed = index + 1;
    if ((index + 1) % RECOMPUTE_EVERY_EVENTS === 0) recomputeRatings();
  }

  recomputeRatings();
  const finishedAt = new Date().toISOString();
  setMeta("last_synced_at", finishedAt);
  state.status = { state: "idle", lastSyncedAt: finishedAt, processed: pending.length, queued: pending.length, message: null };
}
