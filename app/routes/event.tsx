import { data, Link } from "react-router";

import type { Route } from "./+types/event";
import { Bars } from "../components/charts";
import { AllianceChips, TeamChip, useMyTeam } from "../components/team";
import { Badge, Card, Empty, HatchBar, PageHeader, Segmented, Stat, WinProbBar } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { formatDateRange, formatLocation, formatMetric, formatRelativeDay, formatTime, formatShortDate, cleanName } from "../lib/format";
import { countNotesByTeam } from "../lib/notes.server";
import { computeEventOpr, computeSkillsBests, type RatedMatch } from "../lib/ratings";
import {
  getRobotEventById,
  listRobotEventMatches,
  listRobotEventRankings,
  listRobotEventSkills,
  listRobotEventTeams,
} from "../lib/robotevents.server";
import { getStatsForTeams, predictRedWin, predictScore } from "../lib/stats.server";
import { allianceScore, allianceTeams, matchLabel, normalizeTeamNumber } from "../lib/teams";

type Tab = "teams" | "matches" | "rankings" | "skills";
const TABS: Tab[] = ["teams", "matches", "rankings", "skills"];
type Sort = "trueskill" | "opr" | "skills" | "number";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.event.sku ?? "Event"} · RoboRank` }];
}

export async function loader({ request, params, url }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const eventId = Number(params.eventId);
  const event = Number.isFinite(eventId) ? await getRobotEventById(eventId).catch(() => null) : null;
  if (!event) throw data(null, { status: 404 });

  const tab = (TABS.includes(url.searchParams.get("tab") as Tab) ? url.searchParams.get("tab") : "teams") as Tab;
  const sort = (["trueskill", "opr", "skills", "number"].includes(url.searchParams.get("sort") ?? "") ? url.searchParams.get("sort") : "trueskill") as Sort;
  const started = (Date.parse(event.start ?? "") || Infinity) <= Date.now() + 12 * 60 * 60 * 1000;

  const [teams, matches, rankings, skills] = await Promise.all([
    listRobotEventTeams(event.id).catch(() => []),
    started && (tab === "matches" || tab === "teams") ? listRobotEventMatches(event.id).catch(() => []) : Promise.resolve([]),
    started && tab === "rankings" ? listRobotEventRankings(event).catch(() => []) : Promise.resolve([]),
    started && (tab === "skills" || tab === "teams") ? listRobotEventSkills(event.id).catch(() => []) : Promise.resolve([]),
  ]);

  const teamNumbers = teams.map((team) => normalizeTeamNumber(team.number));
  const stats = getStatsForTeams(teamNumbers);
  const notes = countNotesByTeam(teamNumbers);
  const fieldOpr = average([...stats.values()].map((s) => s.opr).filter((v): v is number => v !== null)) ?? 10;

  const parsed = matches
    .map((match) => ({
      id: match.id,
      round: match.round ?? 0,
      instance: match.instance ?? 0,
      matchnum: match.matchnum ?? 0,
      division: match.division?.name ?? "",
      time: match.started ?? match.scheduled ?? null,
      red: allianceTeams(match, "red"),
      blue: allianceTeams(match, "blue"),
      redScore: allianceScore(match, "red") ?? 0,
      blueScore: allianceScore(match, "blue") ?? 0,
    }))
    .filter((match) => match.red.length && match.blue.length)
    .sort((a, b) => a.round - b.round || a.instance - b.instance || a.matchnum - b.matchnum);

  const rated: RatedMatch[] = parsed.map((m) => ({ ...m, eventId: event.id, order: m.matchnum, time: m.time }));
  const eventOpr = new Map(computeEventOpr(rated).map((row) => [row.teamNumber, row]));
  const skillBests = computeSkillsBests(
    skills
      .filter((row) => row.team?.name && typeof row.score === "number" && row.type)
      .map((row) => ({ eventId: event.id, teamNumber: normalizeTeamNumber(row.team!.name), type: row.type!, score: row.score! })),
  );

  const teamRows = teams.map((team) => {
    const number = normalizeTeamNumber(team.number);
    const s = stats.get(number);
    return {
      number,
      name: team.team_name || team.organization || "",
      location: formatLocation([team.location?.city, team.location?.region]),
      trueskill: s && s.matches > 0 ? s.trueskill : null,
      worldRank: s?.rank ?? null,
      record: s && s.matches > 0 ? `${s.wins}-${s.losses}-${s.ties}` : null,
      opr: eventOpr.get(number)?.opr ?? s?.opr ?? null,
      oprIsEvent: eventOpr.has(number),
      skillsBest: s?.skillsBest ?? null,
      skillsHere: skillBests.get(number)?.combined ?? null,
      notes: notes.get(number) ?? 0,
    };
  });

  const sorters: Record<Sort, (a: (typeof teamRows)[number], b: (typeof teamRows)[number]) => number> = {
    trueskill: (a, b) => (b.trueskill ?? -99) - (a.trueskill ?? -99),
    opr: (a, b) => (b.opr ?? -99) - (a.opr ?? -99),
    skills: (a, b) => (b.skillsHere ?? b.skillsBest ?? -1) - (a.skillsHere ?? a.skillsBest ?? -1),
    number: (a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }),
  };
  teamRows.sort(sorters[sort]);

  const ratedRows = teamRows.filter((row) => row.trueskill !== null);
  const myTeam = user.teamCode;
  const myTsRank = [...ratedRows].sort(sorters.trueskill).findIndex((row) => row.number === myTeam);

  return {
    event: {
      id: event.id,
      sku: event.sku,
      name: event.name,
      start: event.start ?? null,
      end: event.end ?? null,
      location: formatLocation([event.location?.city, event.location?.region, event.location?.country]),
      divisions: event.divisions?.length ?? 1,
    },
    tab,
    sort,
    started,
    teams: teamRows,
    summary: {
      teamCount: teams.length,
      avgTrueSkill: average(ratedRows.map((row) => row.trueskill!)),
      favorite: [...ratedRows].sort(sorters.trueskill)[0]?.number ?? null,
      myTsRank: myTsRank >= 0 ? myTsRank + 1 : null,
      ratedCount: ratedRows.length,
      registered: teamNumbers.includes(myTeam),
      played: parsed.filter((m) => m.redScore + m.blueScore > 0).length,
      scheduled: parsed.length,
    },
    matches: parsed.map((match) => {
      const played = match.redScore + match.blueScore > 0;
      return {
        ...match,
        label: matchLabel(match),
        played,
        redWin: predictRedWin(match.red, match.blue, stats),
        redPred: Math.round(predictScore(match.red, stats, fieldOpr)),
        bluePred: Math.round(predictScore(match.blue, stats, fieldOpr)),
      };
    }),
    rankings: rankings
      .map((row) => ({
        id: row.id,
        division: row.division?.name ?? "",
        rank: row.rank ?? 0,
        team: normalizeTeamNumber(row.team?.name),
        record: `${row.wins ?? 0}-${row.losses ?? 0}-${row.ties ?? 0}`,
        wp: row.wp ?? 0,
        ap: row.ap ?? 0,
        sp: row.sp ?? 0,
        avg: row.average_points ?? null,
      }))
      .sort((a, b) => a.division.localeCompare(b.division) || a.rank - b.rank),
    skills: [...skillBests.values()].sort((a, b) => b.combined - a.combined),
  };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export default function EventPage({ loaderData: d }: Route.ComponentProps) {
  const myTeam = useMyTeam();
  const tabLink = (tab: Tab) => `/events/${d.event.id}?tab=${tab}`;
  const sortLink = (sort: Sort) => `/events/${d.event.id}?tab=teams&sort=${sort}`;
  const topTs = Math.max(...d.teams.map((row) => row.trueskill ?? 0), 1);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{d.event.sku}</span>· {formatDateRange(d.event.start, d.event.end)} · {d.event.location}
          </span>
        }
        title={<span className="block max-w-5xl text-3xl leading-tight sm:text-4xl md:text-5xl">{cleanName(d.event.name)}</span>}
        actions={
          <>
            <Link to={`/events/${d.event.id}/simulate`} className="btn btn-primary">
              Simulate event
            </Link>
            {d.summary.registered ? (
              <Link to={`/competition?event=${d.event.id}`} className="btn btn-accent">
                Competition view
              </Link>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <Stat label="Teams" value={d.summary.teamCount} sub={`${d.summary.ratedCount} rated this season`} />
        </div>
        <div className="card">
          <Stat label="Avg TrueSkill" value={formatMetric(d.summary.avgTrueSkill)} sub="Field strength" />
        </div>
        <div className="card">
          <Stat label="Favorite" value={d.summary.favorite ?? "–"} sub="Highest TrueSkill" />
        </div>
        <div className="card">
          {d.summary.registered ? (
            <Stat label={`${myTeam} in this field`} value={d.summary.myTsRank ? `#${d.summary.myTsRank}` : "–"} sub="by TrueSkill" />
          ) : (
            <Stat label="Status" value={d.started ? `${d.summary.played}/${d.summary.scheduled || "–"}` : formatRelativeDay(d.event.start)} sub={d.started ? "matches played" : "until start"} />
          )}
        </div>
      </div>

      <div className="mb-4">
        <Segmented
          items={[
            { to: tabLink("teams"), label: `Teams · ${d.summary.teamCount}`, active: d.tab === "teams" },
            { to: tabLink("matches"), label: "Matches", active: d.tab === "matches" },
            { to: tabLink("rankings"), label: "Rankings", active: d.tab === "rankings" },
            { to: tabLink("skills"), label: "Skills", active: d.tab === "skills" },
          ]}
        />
      </div>

      {d.tab === "teams" ? (
        <Card
          title="Field"
          action={
            <div className="scroll-x flex gap-1 text-sm">
              {(["trueskill", "opr", "skills", "number"] as Sort[]).map((sort) => (
                <Link key={sort} to={sortLink(sort)} className={d.sort === sort ? "pill pill-active py-1.5" : "pill pill-ghost py-1.5"} preventScrollReset>
                  {sort === "trueskill" ? "TrueSkill" : sort === "opr" ? "OPR" : sort === "skills" ? "Skills" : "Number"}
                </Link>
              ))}
            </div>
          }
        >
          {d.teams.length ? (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Name</th>
                    <th className="min-w-40">TrueSkill</th>
                    <th className="num">World</th>
                    <th className="num">Record</th>
                    <th className="num">OPR</th>
                    <th className="num">Skills</th>
                    <th className="num">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {d.teams.map((row) => (
                    <tr key={row.number}>
                      <td>
                        <TeamChip team={row.number} />
                      </td>
                      <td className="max-w-56">
                        <span className="block truncate">{row.name}</span>
                        <span className="block truncate text-xs text-muted">{row.location}</span>
                      </td>
                      <td>
                        {row.trueskill !== null ? (
                          <div className="flex items-center gap-3">
                            <span className="w-10 font-mono">{formatMetric(row.trueskill)}</span>
                            <div className="w-28">
                              <HatchBar value={row.trueskill / topTs} tone={row.number === myTeam ? "accent" : "ink"} />
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted">Unrated</span>
                        )}
                      </td>
                      <td className="num">{row.worldRank ? `#${row.worldRank}` : "–"}</td>
                      <td className="num">{row.record ?? "–"}</td>
                      <td className="num" title={row.oprIsEvent ? "OPR at this event" : "Season OPR"}>
                        {formatMetric(row.opr)}
                        {row.oprIsEvent ? <span className="ml-1 text-accent-strong">•</span> : null}
                      </td>
                      <td className="num">{row.skillsHere ?? row.skillsBest ?? "–"}</td>
                      <td className="num">{row.notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted">
                <span className="text-accent-strong">•</span> OPR from this event's qualification matches; otherwise season OPR.
              </p>
            </div>
          ) : (
            <Empty>No teams registered yet.</Empty>
          )}
        </Card>
      ) : null}

      {d.tab === "matches" ? (
        <Card title="Matches">
          {d.matches.length ? (
            <ul className="divide-y divide-line">
              {d.matches.map((match) => {
                const mine = match.red.includes(myTeam) || match.blue.includes(myTeam);
                return (
                  <li key={match.id} className={mine ? "-mx-3 rounded-2xl bg-accent/15 px-3" : undefined}>
                    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-4 gap-y-2 py-3 md:grid-cols-[4.5rem_minmax(0,1fr)_7rem_minmax(0,1fr)_12rem]">
                      <div>
                        <p className="font-mono text-sm">{match.label}</p>
                        <p className="text-xs text-muted">{match.played ? formatShortDate(match.time) : formatTime(match.time)}</p>
                      </div>
                      <div className="md:text-right">
                        <AllianceChips teams={match.red} tone="red" />
                      </div>
                      <div className="col-start-2 font-mono text-lg md:col-start-auto md:text-center">
                        {match.played ? (
                          <>
                            <span className={match.redScore > match.blueScore ? "text-red" : "text-muted"}>{match.redScore}</span>
                            <span className="text-muted"> – </span>
                            <span className={match.blueScore > match.redScore ? "text-blue" : "text-muted"}>{match.blueScore}</span>
                          </>
                        ) : (
                          <span className="text-sm text-muted">
                            ~{match.redPred} – {match.bluePred}
                          </span>
                        )}
                      </div>
                      <div className="col-start-2 md:col-start-auto">
                        <AllianceChips teams={match.blue} tone="blue" />
                      </div>
                      <div className="col-start-2 md:col-start-auto">
                        <WinProbBar red={match.redWin} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>{d.started ? "No matches published yet." : `The match list appears once the event starts (${formatRelativeDay(d.event.start)}).`}</Empty>
          )}
        </Card>
      ) : null}

      {d.tab === "rankings" ? (
        <Card title="Qualification rankings">
          {d.rankings.length ? (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Team</th>
                    {d.event.divisions > 1 ? <th>Division</th> : null}
                    <th className="num">W-L-T</th>
                    <th className="num">WP</th>
                    <th className="num">AP</th>
                    <th className="num">SP</th>
                    <th className="num">Avg pts</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rankings.map((row) => (
                    <tr key={row.id}>
                      <td className="font-mono">{row.rank}</td>
                      <td>
                        <TeamChip team={row.team} />
                      </td>
                      {d.event.divisions > 1 ? <td>{row.division}</td> : null}
                      <td className="num">{row.record}</td>
                      <td className="num">{row.wp}</td>
                      <td className="num">{row.ap}</td>
                      <td className="num">{row.sp}</td>
                      <td className="num">{formatMetric(row.avg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{d.started ? "Rankings appear after qualification matches are scored." : "Rankings appear once the event starts."}</Empty>
          )}
        </Card>
      ) : null}

      {d.tab === "skills" ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card title="Top skills" className="lg:col-span-5">
            {d.skills.length ? (
              <Bars items={d.skills.slice(0, 8).map((row) => ({ label: row.teamNumber, value: row.combined }))} highlight={myTeam} />
            ) : (
              <Empty>No skills runs recorded at this event.</Empty>
            )}
          </Card>
          <Card title="Skills standings" className="lg:col-span-7">
            {d.skills.length ? (
              <div className="scroll-x">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Team</th>
                      <th className="num">Combined</th>
                      <th className="num">Driver</th>
                      <th className="num">Auton</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.skills.map((row, index) => (
                      <tr key={row.teamNumber}>
                        <td className="font-mono">{index + 1}</td>
                        <td>
                          <TeamChip team={row.teamNumber} />
                        </td>
                        <td className="num">{row.combined}</td>
                        <td className="num">{row.driver}</td>
                        <td className="num">{row.programming}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nothing yet.</Empty>
            )}
          </Card>
        </div>
      ) : null}

      {d.event.divisions > 1 ? (
        <p className="mt-4 text-xs text-muted">
          <Badge>{d.event.divisions} divisions</Badge> Matches and rankings include every division.
        </p>
      ) : null}
    </>
  );
}

export function ErrorBoundary() {
  return (
    <div className="card mt-6">
      <h1 className="display text-5xl">Event not found</h1>
      <p className="mt-3 text-ink-2">RobotEvents has no event with that id.</p>
      <Link to="/events" className="btn btn-primary mt-6">
        Browse events
      </Link>
    </div>
  );
}
