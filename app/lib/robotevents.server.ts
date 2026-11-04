// RobotEvents moved from robotevents.com to events.vex.com in 2026; same v2 API and tokens.
const ROBOTEVENTS_BASE_URL = process.env.ROBOTEVENTS_BASE_URL?.trim() || "https://events.vex.com/api/v2";
const V5RC_PROGRAM_ID = 1;
const ROBOTEVENTS_MAX_RETRIES = 4;
const ROBOTEVENTS_MIN_REQUEST_INTERVAL_MS = 650;
const ROBOTEVENTS_WINDOW_MS = 60_000;
const ROBOTEVENTS_RESPONSE_CACHE_TTL_MS = 30_000;

type QueryScalar = string | number | boolean;
type QueryValue = QueryScalar | QueryScalar[] | null | undefined;
type QueryParams = Record<string, QueryValue>;
type CachedResponse = {
  expiresAt: number;
  value: unknown;
};

type PaginationMeta = {
  current_page?: number;
  last_page?: number;
};

type PaginatedResponse<T> = {
  data?: T[];
  meta?: PaginationMeta;
};

type SingleResponse<T> = {
  data?: T;
};

export type RobotTeam = {
  id: number;
  number: string;
  team_name?: string;
  robot_name?: string;
  organization?: string;
  grade?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
};

export type RobotEvent = {
  id: number;
  sku: string;
  name: string;
  start?: string;
  end?: string;
  season?: {
    id?: number;
    name?: string;
  };
  location?: {
    city?: string;
    region?: string;
    country?: string;
  };
  divisions?: Array<{
    id: number;
    name?: string;
    order?: number;
  }>;
};

export type MatchAllianceTeam = {
  team?: {
    id?: number;
    // In match payloads the team number (e.g. "355V") is in `name`; there is no `number` field.
    name?: string;
  };
  sitting?: boolean;
};

export type MatchAlliance = {
  color?: string;
  score?: number;
  teams?: MatchAllianceTeam[];
};

export type RobotMatch = {
  id: number;
  event?: {
    id?: number;
    name?: string;
    code?: string;
  };
  name?: string;
  round?: number;
  instance?: number;
  matchnum?: number;
  scheduled?: string;
  started?: string;
  field?: string;
  division?: {
    id?: number;
    name?: string;
  };
  alliances?: MatchAlliance[];
};

export type RobotSkillRow = {
  id?: number;
  // As with matches, the team number is in `team.name`.
  team?: { id?: number; name?: string };
  type?: "driver" | "programming" | string;
  score?: number;
  rank?: number;
  attempts?: number;
};

export type EventFilters = {
  region?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  seasonId?: number;
  limit?: number;
};

export class RobotEventsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotEventsConfigurationError";
  }
}

export class RobotEventsRateLimitError extends Error {
  retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "RobotEventsRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isRobotEventsRateLimitError(error: unknown): error is RobotEventsRateLimitError {
  return error instanceof RobotEventsRateLimitError;
}

export function getRobotEventsConfigurationError() {
  if (!process.env.ROBOTEVENTS_API_TOKEN) {
    return "Set ROBOTEVENTS_API_TOKEN to load RobotEvents team/event data.";
  }
  return null;
}

function apiToken() {
  const token = process.env.ROBOTEVENTS_API_TOKEN;
  if (!token) {
    throw new RobotEventsConfigurationError(
      "ROBOTEVENTS_API_TOKEN is required for RobotEvents API requests.",
    );
  }
  return token;
}

function toSearchParams(params: QueryParams = {}) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, String(item));
      }
      continue;
    }

    search.append(key, String(value));
  }

  return search;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// RobotEvents allows ~100 requests/minute per token and reports usage in x-ratelimit-* headers.
// Requests are serialized and spaced to stay under that budget. State lives on globalThis so dev
// hot reloads (which re-evaluate this module) keep sharing one queue with any running sync.
type LimiterState = {
  queue: Promise<void>;
  lastRequestMs: number;
  remaining: number | null;
  remainingSeenAt: number;
  pausedUntil: number;
};

const limiter: LimiterState = ((globalThis as { __roborankLimiter?: LimiterState }).__roborankLimiter ??= {
  queue: Promise.resolve(),
  lastRequestMs: 0,
  remaining: null,
  remainingSeenAt: 0,
  pausedUntil: 0,
});
const robotEventsResponseCache = new Map<string, CachedResponse>();
const robotEventsInflight = new Map<string, Promise<unknown>>();

async function withRobotEventsRateLimit<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    let waitMs = Math.max(0, ROBOTEVENTS_MIN_REQUEST_INTERVAL_MS - (now - limiter.lastRequestMs), limiter.pausedUntil - now);

    // Nearly out of budget for this window: wait for it to roll over.
    if (limiter.remaining !== null && limiter.remaining <= 3 && now - limiter.remainingSeenAt < ROBOTEVENTS_WINDOW_MS) {
      waitMs = Math.max(waitMs, limiter.remainingSeenAt + ROBOTEVENTS_WINDOW_MS - now);
      limiter.remaining = null;
    }

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    limiter.lastRequestMs = Date.now();
    return task();
  };

  const scheduled = limiter.queue.then(run, run);
  limiter.queue = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

function recordRateLimitHeaders(response: Response) {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(remaining) && response.headers.has("x-ratelimit-remaining")) {
    limiter.remaining = remaining;
    limiter.remainingSeenAt = Date.now();
  }
}

function readCachedRobotEventsResponse<T>(cacheKey: string): T | null {
  const cached = robotEventsResponseCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    robotEventsResponseCache.delete(cacheKey);
    return null;
  }
  return cached.value as T;
}

async function requestRobotEvents<T>(path: string, params: QueryParams = {}): Promise<T> {
  const url = new URL(`${ROBOTEVENTS_BASE_URL}${path}`);
  const search = toSearchParams(params);
  url.search = search.toString();
  const cacheKey = url.toString();

  const cached = readCachedRobotEventsResponse<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const inflight = robotEventsInflight.get(cacheKey);
  if (inflight) {
    return (await inflight) as T;
  }

  const requestPromise = (async () => {
    for (let attempt = 0; attempt < ROBOTEVENTS_MAX_RETRIES; attempt += 1) {
      const response = await withRobotEventsRateLimit(() =>
        fetch(url, {
          headers: {
            Authorization: `Bearer ${apiToken()}`,
            Accept: "application/json",
          },
        }),
      );

      recordRateLimitHeaders(response);

      if (response.ok) {
        const json = (await response.json()) as T;
        if (robotEventsResponseCache.size > 400) {
          const now = Date.now();
          for (const [key, entry] of robotEventsResponseCache) {
            if (entry.expiresAt < now) robotEventsResponseCache.delete(key);
          }
        }
        robotEventsResponseCache.set(cacheKey, {
          value: json,
          expiresAt: Date.now() + ROBOTEVENTS_RESPONSE_CACHE_TTL_MS,
        });
        return json;
      }

      const retryAfterHeader = response.headers.get("retry-after");
      const parsedRetryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const retryAfterSeconds = Number.isFinite(parsedRetryAfter) ? parsedRetryAfter : null;
      const body = await response.text();

      // The API has been reported to answer 403 instead of 429 when throttling.
      const throttled = response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
      if (throttled) {
        const waitMs = retryAfterSeconds ? retryAfterSeconds * 1000 : Math.min(60_000, 10_000 * (attempt + 1));
        limiter.pausedUntil = Date.now() + waitMs;
        if (attempt < ROBOTEVENTS_MAX_RETRIES - 1) {
          continue;
        }

        throw new RobotEventsRateLimitError(
          `RobotEvents rate-limited this app (HTTP ${response.status}). ${body.slice(0, 180)}`,
          retryAfterSeconds,
        );
      }

      throw new Error(`RobotEvents request failed (${response.status}): ${body.slice(0, 300)}`);
    }

    throw new RobotEventsRateLimitError("RobotEvents rate-limited this app (retries exhausted).");
  })();

  robotEventsInflight.set(cacheKey, requestPromise);

  try {
    return (await requestPromise) as T;
  } finally {
    robotEventsInflight.delete(cacheKey);
  }
}

async function fetchPaginated<T>(
  path: string,
  params: QueryParams = {},
  maxPages = 3,
): Promise<T[]> {
  let page = 1;
  const allRows: T[] = [];

  while (page <= maxPages) {
    const response = await requestRobotEvents<PaginatedResponse<T>>(path, {
      ...params,
      page,
    });

    const rows = Array.isArray(response.data) ? response.data : [];
    allRows.push(...rows);

    const currentPage = response.meta?.current_page ?? page;
    const lastPage = response.meta?.last_page ?? currentPage;

    if (currentPage >= lastPage) {
      break;
    }

    page += 1;
  }

  return allRows;
}

function dedupeById<T extends { id?: number; number?: string }>(rows: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const row of rows) {
    const key = typeof row.id === "number" ? String(row.id) : row.number ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return unique;
}

// The /teams endpoint only filters by exact team number; name/organization/city params are
// silently ignored (and would return arbitrary teams), so search is number-only.
export async function searchRobotTeams(query: string): Promise<RobotTeam[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rows = await fetchPaginated<RobotTeam>(
    "/teams",
    {
      "program[]": [V5RC_PROGRAM_ID],
      "number[]": [trimmed.toUpperCase()],
      per_page: 15,
    },
    1,
  );

  return dedupeById(rows);
}

export async function getRobotTeamByNumber(teamNumber: string): Promise<RobotTeam | null> {
  const normalized = teamNumber.trim().toUpperCase();
  const matches = await searchRobotTeams(normalized);
  return matches.find((entry) => entry.number?.toUpperCase() === normalized) ?? null;
}

const SEASON_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
let activeSeasonCache: { expiresAt: number; id: number | null } | null = null;

// Current V5RC season id (e.g. 204 for 2026-2027 Override), used to scope team history requests.
export async function getActiveSeasonId(): Promise<number | null> {
  if (activeSeasonCache && activeSeasonCache.expiresAt > Date.now()) {
    return activeSeasonCache.id;
  }

  const seasons = await fetchPaginated<{ id: number; start?: string }>(
    "/seasons",
    { "program[]": [V5RC_PROGRAM_ID], active: true },
    1,
  );
  const latest = seasons.sort((a, b) => (Date.parse(b.start ?? "") || 0) - (Date.parse(a.start ?? "") || 0))[0];
  activeSeasonCache = { id: latest?.id ?? null, expiresAt: Date.now() + SEASON_CACHE_TTL_MS };
  return activeSeasonCache.id;
}

export async function listRobotEvents(filters: EventFilters = {}): Promise<RobotEvent[]> {
  const rows = await fetchPaginated<RobotEvent>(
    "/events",
    {
      "program[]": [V5RC_PROGRAM_ID],
      start: filters.startDate,
      end: filters.endDate,
      "region[]": filters.region ? [filters.region] : undefined,
      "season[]": typeof filters.seasonId === "number" ? [filters.seasonId] : undefined,
      per_page: 50,
    },
    3,
  );

  const search = filters.search?.trim().toLowerCase() ?? "";

  let filtered = rows;
  if (search) {
    filtered = filtered.filter((event) => {
      const haystack = [
        event.name,
        event.sku,
        event.location?.city,
        event.location?.region,
        event.location?.country,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }

  const sorted = filtered.sort((a, b) => {
    const left = Date.parse(a.start ?? "") || 0;
    const right = Date.parse(b.start ?? "") || 0;
    return left - right;
  });

  if (typeof filters.limit === "number") {
    return sorted.slice(0, filters.limit);
  }

  return sorted;
}

// Single-resource endpoints return the object itself (no `data` wrapper).
export async function getRobotEventById(eventId: number): Promise<RobotEvent | null> {
  const response = await requestRobotEvents<RobotEvent | SingleResponse<RobotEvent>>(`/events/${eventId}`);
  if ("id" in response && typeof response.id === "number") return response;
  return (response as SingleResponse<RobotEvent>).data ?? null;
}

export async function listRobotEventTeams(eventId: number): Promise<RobotTeam[]> {
  return fetchPaginated<RobotTeam>(`/events/${eventId}/teams`, { per_page: 250 }, 4);
}

/** Every V5RC event in a season (≈1–3k rows), oldest first. */
export async function listSeasonEvents(seasonId: number): Promise<RobotEvent[]> {
  return fetchPaginated<RobotEvent>("/events", { "program[]": [V5RC_PROGRAM_ID], "season[]": [seasonId], per_page: 250 }, 40);
}

export async function listDivisionMatches(eventId: number, divisionId: number): Promise<RobotMatch[]> {
  return fetchPaginated<RobotMatch>(`/events/${eventId}/divisions/${divisionId}/matches`, { per_page: 250 }, 8);
}

export type RobotRankingRow = {
  id: number;
  event?: { id?: number; name?: string; code?: string };
  division?: { id?: number; name?: string };
  rank?: number;
  team?: { id?: number; name?: string };
  wins?: number;
  losses?: number;
  ties?: number;
  wp?: number;
  ap?: number;
  sp?: number;
  high_score?: number;
  average_points?: number;
};

export type RobotAwardRow = {
  id: number;
  event?: { id?: number; name?: string; code?: string };
  title?: string;
  qualifications?: string[];
};

export async function listRobotTeamRankings(teamId: number): Promise<RobotRankingRow[]> {
  const seasonId = await getActiveSeasonId();
  return fetchPaginated<RobotRankingRow>(`/teams/${teamId}/rankings`, { "season[]": seasonId ? [seasonId] : undefined, per_page: 250 }, 2);
}

export async function listRobotTeamAwards(teamId: number): Promise<RobotAwardRow[]> {
  const seasonId = await getActiveSeasonId();
  return fetchPaginated<RobotAwardRow>(`/teams/${teamId}/awards`, { "season[]": seasonId ? [seasonId] : undefined, per_page: 250 }, 2);
}

export async function listRobotEventRankings(event: RobotEvent): Promise<RobotRankingRow[]> {
  const divisions = event.divisions?.length ? event.divisions : [{ id: 1 }];
  const perDivision = await Promise.all(
    divisions.map((division) => fetchPaginated<RobotRankingRow>(`/events/${event.id}/divisions/${division.id}/rankings`, { per_page: 250 }, 4)),
  );
  return perDivision.flat();
}

// Matches only exist per division (/events/{id}/matches is a 404).
export async function listRobotEventMatches(eventId: number): Promise<RobotMatch[]> {
  const event = await getRobotEventById(eventId);
  const divisions = event?.divisions?.length ? event.divisions : [{ id: 1 }];

  const perDivision = await Promise.all(
    divisions.map((division) =>
      fetchPaginated<RobotMatch>(`/events/${eventId}/divisions/${division.id}/matches`, { per_page: 250 }, 4),
    ),
  );

  return perDivision.flat();
}

export async function listRobotEventSkills(eventId: number): Promise<RobotSkillRow[]> {
  return fetchPaginated<RobotSkillRow>(`/events/${eventId}/skills`, { per_page: 250 }, 4);
}

// Team history endpoints return oldest-first across all seasons, so scope them to the active
// season and sort newest-first before applying `limit`.
export async function listRobotTeamEvents(teamId: number, limit = 15): Promise<RobotEvent[]> {
  const seasonId = await getActiveSeasonId();
  const rows = await fetchPaginated<RobotEvent>(
    `/teams/${teamId}/events`,
    { "season[]": seasonId ? [seasonId] : undefined, per_page: 250 },
    2,
  );

  return rows.sort((a, b) => (Date.parse(b.start ?? "") || 0) - (Date.parse(a.start ?? "") || 0)).slice(0, limit);
}

export async function listRobotTeamMatches(teamId: number, limit = 30): Promise<RobotMatch[]> {
  const seasonId = await getActiveSeasonId();
  const rows = await fetchPaginated<RobotMatch>(
    `/teams/${teamId}/matches`,
    { "season[]": seasonId ? [seasonId] : undefined, per_page: 250 },
    3,
  );

  return rows
    .sort((a, b) => (Date.parse(b.started ?? b.scheduled ?? "") || 0) - (Date.parse(a.started ?? a.scheduled ?? "") || 0))
    .slice(0, limit);
}

export async function findRobotEventBySku(sku: string): Promise<RobotEvent | null> {
  const response = await fetchPaginated<RobotEvent>(
    "/events",
    {
      "program[]": [V5RC_PROGRAM_ID],
      "sku[]": [sku],
      per_page: 3,
    },
    1,
  );

  return response[0] ?? null;
}

function eventContainsDate(event: RobotEvent, date: Date) {
  const startRaw = event.start;
  const endRaw = event.end ?? event.start;
  if (!startRaw || !endRaw) return false;

  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;

  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  return start <= dayEnd && end >= dayStart;
}

export async function findTodayCompetitionForTeam(
  teamNumber: string,
  date = new Date(),
): Promise<RobotEvent | null> {
  const team = await getRobotTeamByNumber(teamNumber);
  if (!team?.id) return null;

  const events = await listRobotTeamEvents(team.id, 40);
  const todayEvent = events.find((event) => eventContainsDate(event, date));
  return todayEvent ?? null;
}
