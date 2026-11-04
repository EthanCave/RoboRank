import { Form, redirect, useActionData, useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import type { MouseEvent } from "react";

import type { Route } from "./+types/scouting";
import { formatDate, formatMetric, formatPercent } from "../lib/format";
import { requireUser } from "../lib/auth.server";
import {
  getRobotEventsConfigurationError,
  getRobotTeamByNumber,
  listRobotTeamEvents,
  listRobotTeamMatches,
  type RobotMatch,
  type RobotEvent,
  type RobotTeam,
} from "../lib/robotevents.server";
import { addScoutingNote, listNotesForTeam, type ScoutingNote } from "../lib/scouting-notes.server";
import {
  getVrcTeamAwards,
  getVrcTeamProfile,
  getVrcTeamRankings,
  readMetricValue,
  toMetricRows,
  type VrcMetricRow,
} from "../lib/vrc-data.server";

type JsonMap = Record<string, unknown>;

type LoaderData = {
  teamNumber: string;
  robotConfigError: string | null;
  robotTeam: RobotTeam | null;
  teamEvents: RobotEvent[];
  vrcMetrics: VrcMetricRow[];
  trueskill: number | null;
  opr: number | null;
  awp: number | null;
  rankingRows: JsonMap[];
  awardRows: JsonMap[];
  recentMatches: RecentMatchCard[];
  scoutingNotes: ScoutingNote[];
};

type ActionData = {
  error?: string;
};

type RecentMatchCard = {
  id: number;
  matchLabel: string;
  event: string;
  date: string | null;
  redTeams: string[];
  blueTeams: string[];
  myAlliance: "red" | "blue" | null;
  teammate: string | null;
  opponents: string;
  resultText: string;
  scoreText: string;
  outcome: "win" | "loss" | "tie" | "pending";
};

type TeamQuickStats = {
  teamNumber: string;
  teamName: string;
  opr: number | null;
  trueskill: number | null;
  winRate: number | null;
};

function normalizeTeamNumber(teamNumber: string) {
  return teamNumber.trim().toUpperCase();
}

function rowsFromPayload(payload: unknown, keys: string[] = ["data", "awards", "results", "items"]) {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is JsonMap => typeof entry === "object" && entry !== null);
  }

  if (payload && typeof payload === "object") {
    const record = payload as JsonMap;

    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter((entry): entry is JsonMap => typeof entry === "object" && entry !== null);
      }
    }

    return [record];
  }

  return [];
}

function currentSeasonCode(now = new Date()) {
  const month = now.getMonth() + 1;
  const seasonStartYear = month >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return String(seasonStartYear % 100).padStart(2, "0");
}

function isEventInCurrentSeason(event: RobotEvent, seasonCode: string) {
  const sku = event.sku?.toUpperCase() ?? "";
  return sku.includes(`V5RC-${seasonCode}-`);
}

function isRankingRowInCurrentSeason(row: JsonMap, seasonCode: string) {
  const directValues = [
    row.sku,
    row.event_sku,
    row.eventSku,
    row.event,
    row.event_name,
    row.eventName,
  ];

  for (const value of directValues) {
    if (typeof value === "string" && value.toUpperCase().includes(`V5RC-${seasonCode}-`)) {
      return true;
    }
  }

  const nestedEvent = row.event;
  if (nestedEvent && typeof nestedEvent === "object") {
    const nestedSku = (nestedEvent as JsonMap).sku;
    if (typeof nestedSku === "string" && nestedSku.toUpperCase().includes(`V5RC-${seasonCode}-`)) {
      return true;
    }
  }

  return false;
}

function firstValue(row: JsonMap, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return null;
}

function fromNestedValue(row: JsonMap, key: string, nestedKey: string) {
  const entry = row[key];
  if (entry && typeof entry === "object") {
    const value = (entry as JsonMap)[nestedKey];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstPresent(values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function matchTitle(match: RobotMatch) {
  const round = typeof match.round === "number" ? `R${match.round}` : null;
  const instance = typeof match.instance === "number" ? `I${match.instance}` : null;
  const matchnum = typeof match.matchnum === "number" ? `M${match.matchnum}` : null;

  return (
    match.name?.trim() ||
    firstPresent([
      round && matchnum ? `${round}-${matchnum}${instance ? `-${instance}` : ""}` : null,
      matchnum,
      "Match",
    ]) ||
    "Match"
  );
}

function allianceTeamNumbers(match: RobotMatch, color: "red" | "blue") {
  return (
    match.alliances
      ?.find((alliance) => alliance.color?.toLowerCase() === color)
      ?.teams?.map((entry) => entry.team?.name ?? entry.team?.number)
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) ?? []
  );
}

function buildRecentMatchCards(matches: RobotMatch[], teamNumber: string): RecentMatchCard[] {
  const normalized = teamNumber.trim().toUpperCase();

  return matches
    .map((match) => {
      const red = match.alliances?.find((alliance) => alliance.color?.toLowerCase() === "red");
      const blue = match.alliances?.find((alliance) => alliance.color?.toLowerCase() === "blue");
      const redTeams = allianceTeamNumbers(match, "red").map((entry) => entry.toUpperCase());
      const blueTeams = allianceTeamNumbers(match, "blue").map((entry) => entry.toUpperCase());

      const myColor = redTeams.includes(normalized) ? "red" : blueTeams.includes(normalized) ? "blue" : null;
      const opponents = myColor === "red" ? blueTeams : myColor === "blue" ? redTeams : [];
      const teammates = myColor === "red" ? redTeams : myColor === "blue" ? blueTeams : [];
      const teammate = teammates.find((entry) => entry !== normalized) ?? null;

      const redScore = typeof red?.score === "number" ? red.score : null;
      const blueScore = typeof blue?.score === "number" ? blue.score : null;
      let outcome: RecentMatchCard["outcome"] = "pending";
      let resultText = "Result unavailable";
      let scoreText = "-";

      if (myColor && redScore !== null && blueScore !== null) {
        const myScore = myColor === "red" ? redScore : blueScore;
        const oppScore = myColor === "red" ? blueScore : redScore;
        outcome = myScore > oppScore ? "win" : myScore < oppScore ? "loss" : "tie";
        const outcomeLabel = outcome === "win" ? "Win" : outcome === "loss" ? "Loss" : "Tie";
        resultText = `${outcomeLabel} • ${myScore}-${oppScore}`;
        scoreText = `${myScore}-${oppScore}`;
      } else if (redScore !== null && blueScore !== null) {
        resultText = `Red ${redScore} - Blue ${blueScore}`;
        scoreText = `${redScore}-${blueScore}`;
      } else if (match.started || match.scheduled) {
        resultText = "Score pending";
        scoreText = "--";
      }

      return {
        id: match.id,
        matchLabel: matchTitle(match),
        event: firstPresent([match.event?.name, match.event?.code]) || "Event",
        date: match.started ?? match.scheduled ?? null,
        redTeams,
        blueTeams,
        myAlliance: myColor,
        teammate,
        opponents: opponents.length ? opponents.join(", ") : "Opponents unavailable",
        resultText,
        scoreText,
        outcome,
      } satisfies RecentMatchCard;
    })
    .sort((a, b) => {
      const left = Date.parse(a.date ?? "") || 0;
      const right = Date.parse(b.date ?? "") || 0;
      return right - left;
    })
    .slice(0, 12);
}

function renderAllianceTeams(
  teams: string[],
  color: "red" | "blue",
  selectedTeam: string,
  onTeamClick: (teamNumber: string, event: MouseEvent<HTMLButtonElement>) => void,
) {
  return teams.map((team) => {
    const isUserTeam = team.toUpperCase() === selectedTeam.toUpperCase();
    const className = isUserTeam ? "team-token user-team team-button" : "team-token team-button";
    return (
      <button
        key={`${color}-${team}`}
        type="button"
        className={className}
        onClick={(event) => onTeamClick(team, event)}
      >
        {team}
      </button>
    );
  });
}

export function meta(_: Route.MetaArgs) {
  return [{ title: "RoboRank | Scouting" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const url = new URL(request.url);
  const teamNumber = normalizeTeamNumber(url.searchParams.get("team") || user.teamCode);

  const robotConfigError = getRobotEventsConfigurationError();

  let robotTeam: RobotTeam | null = null;
  let teamEvents: RobotEvent[] = [];
  let recentMatches: RecentMatchCard[] = [];

  if (!robotConfigError) {
    try {
      robotTeam = await getRobotTeamByNumber(teamNumber);
      if (robotTeam?.id) {
        const seasonCode = currentSeasonCode();
        const allTeamEvents = await listRobotTeamEvents(robotTeam.id, 60);
        teamEvents = allTeamEvents.filter((event) => isEventInCurrentSeason(event, seasonCode)).slice(0, 16);
        const teamMatchRows = await listRobotTeamMatches(robotTeam.id, 60);
        recentMatches = buildRecentMatchCards(teamMatchRows, teamNumber);
      }
    } catch {
      // handled as empty state for this panel
    }
  }

  const [teamProfilePayload, teamRankingPayload, teamAwardsPayload, scoutingNotes] =
    await Promise.all([
      getVrcTeamProfile(teamNumber),
      getVrcTeamRankings(teamNumber),
      getVrcTeamAwards(teamNumber),
      listNotesForTeam(teamNumber),
    ]);

  const vrcMetrics = toMetricRows(teamRankingPayload);
  const trueskill =
    readMetricValue(teamProfilePayload, ["trueskill", "trueskill_mu", "mu", "ts"]) ??
    vrcMetrics[0]?.trueskill ??
    null;
  const opr = readMetricValue(teamProfilePayload, ["opr", "OPR"]) ?? vrcMetrics[0]?.opr ?? null;
  const awp = readMetricValue(teamProfilePayload, ["awp", "AWP", "auton_win_pct"]) ?? vrcMetrics[0]?.awp ?? null;
  const seasonCode = currentSeasonCode();
  const allRankingRows = rowsFromPayload(teamRankingPayload, ["data", "rankings", "results"]);
  const allAwardRows = rowsFromPayload(teamAwardsPayload, ["data", "awards", "results"]);
  const seasonRankingRows = allRankingRows.filter((row) => isRankingRowInCurrentSeason(row, seasonCode));
  const seasonAwardRows = allAwardRows.filter((row) => isRankingRowInCurrentSeason(row, seasonCode));
  const rankingRows = seasonRankingRows.length ? seasonRankingRows : allRankingRows;
  const awardRows = seasonAwardRows.length ? seasonAwardRows : allAwardRows;

  return {
    teamNumber,
    robotConfigError,
    robotTeam,
    teamEvents,
    vrcMetrics,
    trueskill,
    opr,
    awp,
    rankingRows,
    awardRows,
    recentMatches,
    scoutingNotes,
  } satisfies LoaderData;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const formData = await request.formData();

  const intent = String(formData.get("intent") ?? "");
  if (intent !== "add-note") {
    return { error: "Unknown action." } satisfies ActionData;
  }

  const teamNumber = normalizeTeamNumber(String(formData.get("teamNumber") ?? ""));
  const subject = String(formData.get("subject") ?? "");
  const strengths = String(formData.get("strengths") ?? "");
  const concerns = String(formData.get("concerns") ?? "");

  try {
    await addScoutingNote({
      teamNumber,
      subject,
      strengths,
      concerns,
      authorId: user.id,
      authorName: user.name,
    });

    return redirect(`/scouting?team=${encodeURIComponent(teamNumber)}`);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save note.",
    } satisfies ActionData;
  }
}

export default function ScoutingPage() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const actionData = useActionData<typeof action>() as ActionData | undefined;
  const quickStatsFetcher = useFetcher<TeamQuickStats | { error: string }>();
  const [selectedTeamNumber, setSelectedTeamNumber] = useState<string | null>(null);
  const quickStatsData = quickStatsFetcher.data;
  const quickStatsError =
    quickStatsData && "error" in quickStatsData ? quickStatsData.error : null;
  const loadedQuickStats =
    quickStatsData && !("error" in quickStatsData) ? quickStatsData : null;

  function onTeamClick(teamNumber: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const normalized = teamNumber.toUpperCase();
    setSelectedTeamNumber(normalized);
    quickStatsFetcher.load(`/team-quick-stats?team=${encodeURIComponent(normalized)}`);
  }

  return (
    <section className="page-grid single-column">
      <article className="panel">
        <header className="panel-head between">
          <div>
            <p className="eyebrow">Scouting</p>
            <h2>Team {data.teamNumber}</h2>
          </div>

          <Form method="get" className="inline-search">
            <input type="text" name="team" defaultValue={data.teamNumber} placeholder="Search team" />
            <button type="submit" className="btn-primary compact">
              Load team
            </button>
          </Form>
        </header>

        {data.robotConfigError ? <p className="notice">{data.robotConfigError}</p> : null}

        <div className="metric-grid">
          <div>
            <p>TrueSkill</p>
            <strong>{formatMetric(data.trueskill)}</strong>
          </div>
          <div>
            <p>OPR</p>
            <strong>{formatMetric(data.opr)}</strong>
          </div>
          <div>
            <p>AWP</p>
            <strong>{formatPercent(data.awp)}</strong>
          </div>
          <div>
            <p>Saved Notes</p>
            <strong>{data.scoutingNotes.length}</strong>
          </div>
        </div>
      </article>

      <div className="page-grid two-column">
        <article className="panel">
          <header>
            <p className="eyebrow">Identity</p>
            <h3>{data.robotTeam?.team_name || data.robotTeam?.organization || "Team profile"}</h3>
          </header>

          <dl className="detail-grid">
            <div>
              <dt>Number</dt>
              <dd>{data.robotTeam?.number ?? data.teamNumber}</dd>
            </div>
            <div>
              <dt>Robot</dt>
              <dd>{data.robotTeam?.robot_name || "-"}</dd>
            </div>
            <div>
              <dt>Organization</dt>
              <dd>{data.robotTeam?.organization || "-"}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>
                {[data.robotTeam?.location?.city, data.robotTeam?.location?.region]
                  .filter(Boolean)
                  .join(", ") || "-"}
              </dd>
            </div>
          </dl>

          <h4 className="subheading">Past events</h4>
          {data.teamEvents.length ? (
            <ul className="list-block dense list-scroll">
              {data.teamEvents.map((event) => (
                <li key={event.id}>
                  <strong>{event.name}</strong>
                  <span>
                    {event.sku} • {formatDate(event.start)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No RobotEvents history returned for this team.</p>
          )}
        </article>

        <article className="panel">
          <header>
            <p className="eyebrow">Performance history</p>
            <h3>Rankings + awards</h3>
          </header>

          {data.rankingRows.length ? (
            <ul className="list-block dense list-scroll">
              {data.rankingRows.slice(0, 10).map((row, index) => (
                <li key={`ranking-${index}`}>
                  <strong>
                    {firstValue(row, ["event", "event_name", "eventName", "sku", "event_sku"]) ||
                      fromNestedValue(row, "event", "name") ||
                      "Event"}
                  </strong>
                  <span>
                    Rank {firstValue(row, ["rank", "current_rank", "ranking"]) || "-"} • TrueSkill{" "}
                    {firstValue(row, ["trueskill", "trueSkill", "trueskill_mu", "mu", "ts"]) || "-"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No ranking history returned from vrc-data-analysis.</p>
          )}

          <h4 className="subheading">Awards</h4>
          {data.awardRows.length ? (
            <ul className="list-block dense list-scroll">
              {data.awardRows.slice(0, 10).map((row, index) => (
                <li key={`award-${index}`}>
                  <strong>
                    {firstValue(row, ["award", "award_name", "name", "title"]) || "Award"}
                  </strong>
                  <span>
                    {firstValue(row, ["event", "event_name", "sku", "event_sku"]) ||
                      fromNestedValue(row, "event", "name") ||
                      "Event"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No awards found.</p>
          )}
        </article>
      </div>

      <div className="page-grid two-column">
        <article className="panel">
          <header>
            <p className="eyebrow">Recent matches</p>
            <h3>Most recent entries</h3>
          </header>

          {data.recentMatches.length ? (
            <ul className="list-block dense list-scroll recent-match-list">
              {data.recentMatches.map((match) => (
                <li key={match.id} className="recent-match-shell">
                  <details className="recent-match-expand">
                    <summary className="score-strip">
                      <span className="strip-meta">
                        <span className={`match-label ${match.outcome}`}>{match.matchLabel}</span>
                        <span> • {formatDate(match.date)}</span>
                      </span>
                      <div className="score-strip-main">
                        <div className="alliance-side red-side">
                          {renderAllianceTeams(match.redTeams, "red", data.teamNumber, onTeamClick)}
                        </div>
                        <div className="alliance-score">{match.scoreText}</div>
                        <div className="alliance-side blue-side">
                          {renderAllianceTeams(match.blueTeams, "blue", data.teamNumber, onTeamClick)}
                        </div>
                      </div>
                      <span className="chev">&gt;</span>
                    </summary>

                    <div className="score-details">
                      <span>
                        <strong>{match.matchLabel}</strong> • {match.event} • {formatDate(match.date)}
                      </span>
                      <span className={`recent-result ${match.outcome}`}>{match.resultText}</span>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No recent match rows available.</p>
          )}
        </article>

        <article className="panel" id="notes">
          <header>
            <p className="eyebrow">Shared scouting notes</p>
            <h3>Team observations</h3>
          </header>

          {actionData?.error ? <p className="form-error">{actionData.error}</p> : null}

          <Form method="post" className="stack-form">
            <input type="hidden" name="intent" value="add-note" />
            <input type="hidden" name="teamNumber" value={data.teamNumber} />

            <label>
              <span>Subject</span>
              <input type="text" name="subject" placeholder="Auton consistency" required />
            </label>
            <label>
              <span>Strengths</span>
              <textarea name="strengths" rows={3} placeholder="Fast cycle times, clean intake." required />
            </label>
            <label>
              <span>Concerns</span>
              <textarea name="concerns" rows={3} placeholder="Vulnerable to defensive pressure." required />
            </label>

            <button type="submit" className="btn-primary">
              Save note
            </button>
          </Form>

          {data.scoutingNotes.length ? (
            <ul className="list-block">
              {data.scoutingNotes.map((note) => (
                <li key={note.id}>
                  <strong>{note.subject}</strong>
                  <span>
                    {note.authorName} • {formatDate(note.createdAt)}
                  </span>
                  <p>{note.strengths}</p>
                  <p>{note.concerns}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No scouting notes yet for this team.</p>
          )}
        </article>
      </div>

      {selectedTeamNumber ? (
        <div className="team-popup-backdrop" onClick={() => setSelectedTeamNumber(null)}>
          <div className="team-popup-card" onClick={(event) => event.stopPropagation()}>
            <header>
              <p className="eyebrow">Team quick stats</p>
              <h3>{selectedTeamNumber}</h3>
            </header>
            {quickStatsError ? (
              <p className="form-error">{quickStatsError}</p>
            ) : quickStatsFetcher.state !== "idle" ? (
              <p className="empty-state">Loading stats...</p>
            ) : loadedQuickStats ? (
              <>
                <p>{loadedQuickStats.teamName}</p>
                <dl className="detail-grid">
                  <div>
                    <dt>OPR</dt>
                    <dd>{formatMetric(loadedQuickStats.opr)}</dd>
                  </div>
                  <div>
                    <dt>Win Rate</dt>
                    <dd>{formatPercent(loadedQuickStats.winRate)}</dd>
                  </div>
                  <div>
                    <dt>TrueSkill</dt>
                    <dd>{formatMetric(loadedQuickStats.trueskill)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="empty-state">No stats available.</p>
            )}
            <button type="button" className="btn-secondary compact" onClick={() => setSelectedTeamNumber(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
