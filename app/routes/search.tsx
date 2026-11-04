import type { Route } from "./+types/search";
import { requireUser } from "../lib/auth.server";
import { getRobotTeamByNumber } from "../lib/robotevents.server";
import { searchEvents, searchTeamNumbers } from "../lib/stats.server";
import { normalizeTeamNumber } from "../lib/teams";

export type SearchResults = {
  query: string;
  teams: string[];
  events: Array<{ id: number; sku: string; name: string; start: string | null; region: string | null }>;
};

// Type-ahead for the global search box: team numbers and events come from the local season
// index; an exact team number not yet seen in any match is confirmed against RobotEvents.
export async function loader({ request, url }: Route.LoaderArgs): Promise<SearchResults> {
  await requireUser(request);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return { query, teams: [], events: [] };

  const teams = searchTeamNumbers(query);
  const exact = normalizeTeamNumber(query);
  if (/^\d+[A-Z]?$/.test(exact) && !teams.includes(exact)) {
    const team = await getRobotTeamByNumber(exact).catch(() => null);
    if (team) teams.unshift(team.number);
  }

  const events = /^\d+$/.test(query) ? [] : searchEvents(query, 6);
  return {
    query,
    teams: teams.slice(0, 8),
    events: events.map((event) => ({ id: event.id, sku: event.sku, name: event.name, start: event.start, region: event.region })),
  };
}
