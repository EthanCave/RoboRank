const VRC_DATA_BASE_URL = "https://vrc-data-analysis.com/v1";
const CACHE_TTL_MS = 1000 * 60 * 5;

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();

type JsonMap = Record<string, unknown>;

export type VrcMetricRow = {
  teamNumber: string;
  rank: number | null;
  trueskill: number | null;
  opr: number | null;
  awp: number | null;
  raw: JsonMap;
};

function fromCache<T>(key: string): T | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt < Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return cached.value as T;
}

function saveCache(key: string, value: unknown) {
  responseCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });
}

function unwrapData(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as JsonMap;

  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.rankings)) return record.rankings;
  if (Array.isArray(record.matches)) return record.matches;
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.items)) return record.items;

  return payload;
}

function toRows(payload: unknown): JsonMap[] {
  const unwrapped = unwrapData(payload);

  if (Array.isArray(unwrapped)) {
    return unwrapped.filter((entry): entry is JsonMap => {
      return typeof entry === "object" && entry !== null;
    });
  }

  if (typeof unwrapped === "object" && unwrapped !== null) {
    return [unwrapped as JsonMap];
  }

  return [];
}

function readNumber(row: JsonMap, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function readString(row: JsonMap, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readTeamNumber(row: JsonMap): string | null {
  const direct = readString(row, [
    "team",
    "teamNumber",
    "team_number",
    "team_num",
    "number",
  ]);

  if (direct) return direct.toUpperCase();

  const nested = row.team;
  if (nested && typeof nested === "object") {
    const nestedNumber = readString(nested as JsonMap, ["number", "team", "team_number"]);
    if (nestedNumber) return nestedNumber.toUpperCase();
  }

  return null;
}

export function toMetricRows(payload: unknown): VrcMetricRow[] {
  const rows = toRows(payload);

  return rows
    .map((row) => {
      const teamNumber = readTeamNumber(row);
      if (!teamNumber) return null;

      const trueskill = readNumber(row, [
        "trueskill",
        "trueSkill",
        "trueskill_mu",
        "mu",
        "ts",
      ]);

      return {
        teamNumber,
        rank: readNumber(row, ["rank", "current_rank", "ranking"]),
        trueskill,
        opr: readNumber(row, ["opr", "OPR"]),
        awp: readNumber(row, ["awp", "AWP", "auton_win_pct"]),
        raw: row,
      } satisfies VrcMetricRow;
    })
    .filter((row): row is VrcMetricRow => Boolean(row));
}

export function readMetricValue(payload: unknown, keys: string[]): number | null {
  const rows = toRows(payload);
  if (!rows[0]) return null;
  return readNumber(rows[0], keys);
}

async function requestVrc(path: string): Promise<unknown | null> {
  const cached = fromCache<unknown>(path);
  if (cached !== null) return cached;

  const response = await fetch(`${VRC_DATA_BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }

  saveCache(path, json);
  return json;
}

export async function getVrcTeamProfile(teamNumber: string) {
  return requestVrc(`/team/${encodeURIComponent(teamNumber.toUpperCase())}`);
}

export async function getVrcTeamRankings(teamNumber: string) {
  return requestVrc(`/rankings/team/${encodeURIComponent(teamNumber.toUpperCase())}`);
}

export async function getVrcTeamMatches(teamNumber: string) {
  return requestVrc(`/matches/team/${encodeURIComponent(teamNumber.toUpperCase())}`);
}

export async function getVrcTeamAwards(teamNumber: string) {
  return requestVrc(`/awards/team/${encodeURIComponent(teamNumber.toUpperCase())}`);
}

export async function getVrcEventRankings(eventSku: string) {
  return requestVrc(`/rankings/event/${encodeURIComponent(eventSku)}`);
}

export async function getVrcEventMatches(eventSku: string) {
  return requestVrc(`/matches/event/${encodeURIComponent(eventSku)}`);
}
