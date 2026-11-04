import {
  getRobotEventsConfigurationError,
  getRobotTeamByNumber,
  listRobotTeamEvents,
  type RobotEvent,
  type RobotTeam,
} from "./robotevents.server";
import { isEventOnDay } from "./format";
import { normalizeTeamNumber } from "./teams";

// Team identity + this season's registered events, cached because the app shell needs it on
// every navigation (to flag competition days) and RobotEvents allows ~100 requests/minute.

const TTL_MS = 1000 * 60 * 10;

export type TeamContext = {
  team: RobotTeam | null;
  events: RobotEvent[];
  today: RobotEvent | null;
  next: RobotEvent | null;
};

type CacheEntry = { expiresAt: number; value: Promise<TeamContext> };
const cache: Map<string, CacheEntry> = ((globalThis as { __roborankTeamCtx?: Map<string, CacheEntry> }).__roborankTeamCtx ??= new Map());

const EMPTY: TeamContext = { team: null, events: [], today: null, next: null };

async function load(teamNumber: string): Promise<TeamContext> {
  const team = await getRobotTeamByNumber(teamNumber);
  if (!team) return EMPTY;

  const events = (await listRobotTeamEvents(team.id, 100)).sort((a, b) => (Date.parse(a.start ?? "") || 0) - (Date.parse(b.start ?? "") || 0));
  const now = new Date();
  const today = events.find((event) => isEventOnDay(event, now)) ?? null;
  const next = events.find((event) => (Date.parse(event.end ?? event.start ?? "") || 0) >= now.getTime()) ?? null;
  return { team, events, today, next };
}

export function getTeamContext(teamNumber: string): Promise<TeamContext> {
  const key = normalizeTeamNumber(teamNumber);
  if (!key || getRobotEventsConfigurationError()) return Promise.resolve(EMPTY);

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = load(key).catch(() => {
    cache.delete(key);
    return EMPTY;
  });
  cache.set(key, { expiresAt: Date.now() + TTL_MS, value });
  return value;
}
