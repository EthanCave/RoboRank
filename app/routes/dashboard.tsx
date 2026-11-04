import { Form, Link, useLoaderData } from "react-router";

import type { Route } from "./+types/dashboard";
import { formatDate, formatMetric } from "../lib/format";
import { requireUser } from "../lib/auth.server";
import {
  getRobotEventsConfigurationError,
  listRobotEventTeams,
  listRobotEvents,
  type RobotEvent,
  type RobotTeam,
} from "../lib/robotevents.server";
import {
  getVrcEventRankings,
  getVrcTeamProfile,
  readMetricValue,
  toMetricRows,
  type VrcMetricRow,
} from "../lib/vrc-data.server";

type LoaderData = {
  eventSearch: string;
  selectedEventId: number | null;
  selectedEvent: RobotEvent | null;
  events: RobotEvent[];
  rankingRows: VrcMetricRow[];
  robotConfigError: string | null;
  teamTrueSkill: number | null;
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

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

async function buildFallbackRankingRows(eventId: number, limit = 28): Promise<VrcMetricRow[]> {
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
        rank: null as number | null,
        trueskill,
        opr,
        awp,
        raw: {},
      } as VrcMetricRow;
    }),
  );

  return rows.filter((row): row is VrcMetricRow => row !== null);
}

export function meta(_: Route.MetaArgs) {
  return [{ title: "RoboRank | Data Dashboard" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);

  const eventSearch = url.searchParams.get("eventSearch")?.trim() ?? "";
  const selectedEventId = Number(url.searchParams.get("eventId") ?? "") || null;

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
      // fallback to empty list
    }
  }

  const selectedEvent =
    events.find((entry) => entry.id === selectedEventId) ??
    (selectedEventId ? null : events[0] ?? null);

  const [eventRankingsPayload, teamProfilePayload] = await Promise.all([
    selectedEvent?.sku ? getVrcEventRankings(selectedEvent.sku) : Promise.resolve(null),
    getVrcTeamProfile(user.teamCode),
  ]);

  let rankingRows = toMetricRows(eventRankingsPayload)
    .sort((a, b) => (b.trueskill ?? 0) - (a.trueskill ?? 0))
    .slice(0, 40);

  if (!rankingRows.length && selectedEvent?.id) {
    rankingRows = (await buildFallbackRankingRows(selectedEvent.id))
      .sort((a, b) => (b.trueskill ?? 0) - (a.trueskill ?? 0))
      .slice(0, 40);
  }

  const teamTrueSkill = readMetricValue(teamProfilePayload, ["trueskill", "trueSkill", "mu", "trueskill_mu", "ts"]);

  return {
    eventSearch,
    selectedEventId: selectedEvent?.id ?? null,
    selectedEvent,
    events,
    rankingRows,
    robotConfigError,
    teamTrueSkill,
  } satisfies LoaderData;
}

export default function DataDashboardPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;

  const rankedTrueSkills = data.rankingRows
    .map((row) => row.trueskill)
    .filter((value): value is number => typeof value === "number");

  const eventAverageTrueSkill = average(rankedTrueSkills);
  const eventLeader = data.rankingRows[0] ?? null;
  const maxTrueSkill = rankedTrueSkills[0] ?? 0;

  return (
    <section className="page-grid single-column">
      <article className="panel">
        <header className="panel-head between">
          <div>
            <p className="eyebrow">Data Dashboard</p>
            <h2>Event intelligence</h2>
          </div>

          <Form method="get" className="inline-search wide">
            <input
              type="search"
              name="eventSearch"
              defaultValue={data.eventSearch}
              placeholder="Filter events"
            />
            <button type="submit" className="btn-primary compact">
              Filter
            </button>
          </Form>
        </header>

        {data.robotConfigError ? <p className="notice">{data.robotConfigError}</p> : null}

        <div className="events-scroll">
          {data.events.map((event) => (
            <Form method="get" key={event.id}>
              <input type="hidden" name="eventSearch" value={data.eventSearch} />
              <input type="hidden" name="eventId" value={event.id} />
              <button
                type="submit"
                className={event.id === data.selectedEventId ? "event-pill selected" : "event-pill"}
              >
                <strong>{event.sku}</strong>
                <span>{event.name}</span>
              </button>
            </Form>
          ))}

          {!data.events.length ? <p className="empty-state">No events found for the selected window.</p> : null}
        </div>
      </article>

      <article className="panel">
        <header>
          <p className="eyebrow">Selected event</p>
          <h3>{data.selectedEvent?.name ?? "No event selected"}</h3>
        </header>

        {data.selectedEvent ? (
          <Link
            to={`/simulation?eventId=${data.selectedEvent.id}&eventSearch=${encodeURIComponent(data.eventSearch)}`}
            className="btn-primary inline-btn"
          >
            Simulate competition
          </Link>
        ) : null}

        <div className="metric-grid">
          <div>
            <p>Event SKU</p>
            <strong>{data.selectedEvent?.sku ?? "-"}</strong>
          </div>
          <div>
            <p>Date</p>
            <strong>{formatDate(data.selectedEvent?.start ?? null)}</strong>
          </div>
          <div>
            <p>Average TrueSkill</p>
            <strong>{formatMetric(eventAverageTrueSkill)}</strong>
          </div>
          <div>
            <p>Your Team TrueSkill</p>
            <strong>{formatMetric(data.teamTrueSkill)}</strong>
          </div>
          <div>
            <p>Likely #1</p>
            <strong>{eventLeader ? eventLeader.teamNumber : "-"}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <header>
          <p className="eyebrow">Top contenders</p>
          <h3>TrueSkill leaderboard</h3>
        </header>

        {data.rankingRows.length ? (
          <ul className="rank-list">
            {data.rankingRows.slice(0, 15).map((row, index) => {
              const normalized = maxTrueSkill > 0 && row.trueskill ? row.trueskill / maxTrueSkill : 0;
              return (
                <li key={`${row.teamNumber}-${index}`}>
                  <div>
                    <strong>
                      #{index + 1} {row.teamNumber}
                    </strong>
                    <span>
                      TS {formatMetric(row.trueskill)} • OPR {formatMetric(row.opr)}
                    </span>
                  </div>
                  <div className="bar-track">
                    <span style={{ width: `${Math.max(6, normalized * 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty-state">No ranking data returned for this event from vrc-data-analysis.</p>
        )}
      </article>
    </section>
  );
}
