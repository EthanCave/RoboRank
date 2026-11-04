import { Form, Link } from "react-router";

import type { Route } from "./+types/events";
import { Badge, Empty, PageHeader, Segmented } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { getDb } from "../lib/db.server";
import { cleanName, formatDateRange, formatLocation, formatRelativeDay, isEventOnDay } from "../lib/format";
import { getTeamContext } from "../lib/my-team.server";
import { listRobotEvents } from "../lib/robotevents.server";

type View = "upcoming" | "past" | "mine";

type EventCard = {
  id: number;
  sku: string;
  name: string;
  start: string | null;
  end: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  matches?: number;
};

export function meta(_: Route.MetaArgs) {
  return [{ title: "Events · RoboRank" }];
}

const PAGE = 48;

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const view = (["upcoming", "past", "mine"].includes(url.searchParams.get("view") ?? "") ? url.searchParams.get("view") : "upcoming") as View;
  const q = url.searchParams.get("q")?.trim() ?? "";
  const region = url.searchParams.get("region")?.trim() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit")) || PAGE, 500);
  const db = getDb();
  const nowIso = new Date().toISOString();

  const regions = (db.prepare("SELECT DISTINCT region FROM events WHERE region IS NOT NULL AND region != '' ORDER BY region").all() as Array<{ region: string }>).map(
    (row) => row.region,
  );

  let events: EventCard[] = [];
  let total = 0;

  if (view === "mine") {
    const context = await getTeamContext(user.teamCode);
    events = context.events.map((event) => ({
      id: event.id,
      sku: event.sku,
      name: event.name,
      start: event.start ?? null,
      end: event.end ?? null,
      city: event.location?.city ?? null,
      region: event.location?.region ?? null,
      country: event.location?.country ?? null,
    }));
    total = events.length;
  } else {
    const where: string[] = [view === "upcoming" ? "COALESCE(end, start) >= ?" : "start < ?"];
    const params: Array<string | number> = [view === "upcoming" ? nowIso.slice(0, 10) : nowIso];
    if (q) {
      where.push("(name LIKE ? OR sku LIKE ? OR city LIKE ?)");
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (region) {
      where.push("region = ?");
      params.push(region);
    }
    const clause = where.join(" AND ");
    total = (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${clause}`).get(...params) as { n: number }).n;
    events = db
      .prepare(
        `SELECT e.id, e.sku, e.name, e.start, e.end, e.city, e.region, e.country,
                (SELECT COUNT(*) FROM matches m WHERE m.event_id = e.id) AS matches
         FROM events e WHERE ${clause} ORDER BY start ${view === "upcoming" ? "ASC" : "DESC"} LIMIT ?`,
      )
      .all(...params, limit) as EventCard[];

    // Before the first sync has listed the season, fall back to the live API.
    if (!total && !q && !region && view === "upcoming") {
      const live = await listRobotEvents({ startDate: nowIso.slice(0, 10), limit }).catch(() => []);
      events = live.map((event) => ({
        id: event.id,
        sku: event.sku,
        name: event.name,
        start: event.start ?? null,
        end: event.end ?? null,
        city: event.location?.city ?? null,
        region: event.location?.region ?? null,
        country: event.location?.country ?? null,
      }));
      total = events.length;
    }
  }

  return { view, q, region, regions, events, total, limit };
}

function DateTile({ iso }: { iso: string | null }) {
  const date = iso ? new Date(iso) : null;
  return (
    <div className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-surface-2 text-center">
      {date ? (
        <span>
          <span className="block text-xs uppercase text-muted">{date.toLocaleString("en-US", { month: "short" })}</span>
          <span className="display block text-2xl tabular-nums">{date.getDate()}</span>
        </span>
      ) : (
        <span className="text-xs text-muted">TBD</span>
      )}
    </div>
  );
}

export default function EventsPage({ loaderData: d }: Route.ComponentProps) {
  const base = new URLSearchParams();
  if (d.q) base.set("q", d.q);
  if (d.region) base.set("region", d.region);
  const tab = (view: View) => {
    const params = new URLSearchParams(base);
    params.set("view", view);
    return `/events?${params}`;
  };
  const more = new URLSearchParams(base);
  more.set("view", d.view);
  more.set("limit", String(d.limit + PAGE));

  return (
    <>
      <PageHeader
        eyebrow="V5RC season"
        title="Events"
        actions={
          <Segmented
            items={[
              { to: tab("upcoming"), label: "Upcoming", active: d.view === "upcoming" },
              { to: tab("past"), label: "Results", active: d.view === "past" },
              { to: tab("mine"), label: "Our events", active: d.view === "mine" },
            ]}
          />
        }
      />

      {d.view !== "mine" ? (
        <Form method="get" className="mb-6 flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="view" value={d.view} />
          <input type="search" name="q" defaultValue={d.q} placeholder="Search name, SKU, or city" className="field sm:max-w-sm" aria-label="Search events" />
          <select name="region" defaultValue={d.region} className="field sm:max-w-56" aria-label="Region">
            <option value="">All regions</option>
            {d.regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary">
            Filter
          </button>
        </Form>
      ) : null}

      <p className="eyebrow mb-3">
        {d.total.toLocaleString()} {d.total === 1 ? "event" : "events"}
      </p>

      {d.events.length ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.events.map((event) => {
            const live = isEventOnDay(event);
            return (
              <li key={event.id}>
                <Link to={`/events/${event.id}`} className="card flex h-full gap-4 p-5 transition hover:-translate-y-0.5">
                  <DateTile iso={event.start} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{event.sku}</span>
                      {live ? <Badge tone="accent">Live</Badge> : null}
                      {d.view === "past" && event.matches ? <Badge>{event.matches} matches</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 font-medium leading-snug">{cleanName(event.name)}</p>
                    <p className="mt-2 text-sm text-muted">
                      {formatDateRange(event.start, event.end)} · {formatRelativeDay(event.start)}
                    </p>
                    <p className="text-sm text-muted">{formatLocation([event.city, event.region])}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>{d.view === "mine" ? "Your team has no registered events this season." : "No events match these filters."}</Empty>
      )}

      {d.view !== "mine" && d.events.length < d.total ? (
        <div className="mt-6 flex justify-center">
          <Link to={`/events?${more}`} className="btn btn-quiet" preventScrollReset>
            Show more
          </Link>
        </div>
      ) : null}
    </>
  );
}
