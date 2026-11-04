import { data, Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/team";
import { FormChart, StepChart } from "../components/charts";
import { TeamChip, useMyTeam } from "../components/team";
import { Badge, Card, Empty, PageHeader, ResultPill, Stat } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { formatDate, formatDateRange, formatLocation, formatMetric, formatPercent, formatRecord, formatShortDate, ordinal, cleanName } from "../lib/format";
import { addScoutingNote, deleteScoutingNote, listNotesForTeam } from "../lib/notes.server";
import { trueSkillHistory, winProbability } from "../lib/ratings";
import { getRobotTeamByNumber, listRobotTeamAwards, listRobotTeamEvents, listRobotTeamRankings } from "../lib/robotevents.server";
import { loadRatedMatches } from "../lib/season-sync.server";
import { countRatedTeams, getIndexedTeamMatches, getTeamStats } from "../lib/stats.server";
import { matchLabel, normalizeTeamNumber } from "../lib/teams";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.teamNumber ?? "Team"} · RoboRank` }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const teamNumber = normalizeTeamNumber(params.teamNumber);
  const [robotTeam, stats] = [await getRobotTeamByNumber(teamNumber).catch(() => null), getTeamStats(teamNumber)];
  if (!robotTeam && !stats) throw data(null, { status: 404 });

  const [rankings, awards, events] = robotTeam
    ? await Promise.all([
        listRobotTeamRankings(robotTeam.id).catch(() => []),
        listRobotTeamAwards(robotTeam.id).catch(() => []),
        listRobotTeamEvents(robotTeam.id, 40).catch(() => []),
      ])
    : [[], [], []];

  const indexed = getIndexedTeamMatches(teamNumber).filter((m) => m.round !== 1);
  const history = stats?.matches ? trueSkillHistory(loadRatedMatches(), teamNumber).map((point) => point.trueskill) : [];
  const myStats = user.teamCode !== teamNumber ? getTeamStats(user.teamCode) : null;

  return {
    teamNumber,
    robotTeam,
    stats,
    ratedTeams: countRatedTeams(),
    history,
    // Head-to-head with two average partners on each side.
    matchupVsMine: myStats && stats ? winProbability([myStats, undefined], [stats, undefined]) : null,
    matches: indexed.slice(0, 30).map((match) => {
      const onRed = match.red.includes(teamNumber);
      return {
        id: match.id,
        label: matchLabel({ round: match.round, instance: match.instance ?? 0, matchnum: match.matchnum ?? 0 }),
        eventId: match.eventId,
        eventName: match.eventName,
        time: match.time,
        red: match.red,
        blue: match.blue,
        redScore: match.redScore,
        blueScore: match.blueScore,
        played: match.redScore + match.blueScore > 0,
        color: onRed ? ("red" as const) : ("blue" as const),
      };
    }),
    rankings: rankings
      .map((row) => ({
        id: row.id,
        eventId: row.event?.id ?? 0,
        eventName: row.event?.name ?? "Event",
        rank: row.rank ?? null,
        record: formatRecord(row.wins ?? 0, row.losses ?? 0, row.ties ?? 0),
        wp: row.wp ?? 0,
        ap: row.ap ?? 0,
        sp: row.sp ?? 0,
        highScore: row.high_score ?? null,
      }))
      .reverse(),
    awards: awards.map((award) => ({ id: award.id, title: award.title?.replace(/\s*\(.*\)$/, "") ?? "Award", eventName: award.event?.name ?? "", eventId: award.event?.id ?? 0 })),
    upcoming: events
      .filter((event) => (Date.parse(event.end ?? event.start ?? "") || 0) >= Date.now())
      .sort((a, b) => (Date.parse(a.start ?? "") || 0) - (Date.parse(b.start ?? "") || 0)),
    notes: listNotesForTeam(teamNumber),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete-note") {
    deleteScoutingNote(String(form.get("noteId") ?? ""));
    return { ok: true as const };
  }

  try {
    addScoutingNote({
      teamNumber: params.teamNumber,
      authorName: String(form.get("author") ?? "") || user.teamCode,
      subject: String(form.get("subject") ?? ""),
      strengths: String(form.get("strengths") ?? ""),
      concerns: String(form.get("concerns") ?? ""),
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not save the note." };
  }
}

export default function TeamPage({ loaderData: d, actionData }: Route.ComponentProps) {
  const myTeam = useMyTeam();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting" && navigation.formData?.get("intent") === "add-note";
  const { stats } = d;
  const played = d.matches.filter((m) => m.played);
  const form = [...played]
    .slice(0, 16)
    .reverse()
    .map((m) => {
      const ours = m.color === "red" ? m.redScore : m.blueScore;
      const theirs = m.color === "red" ? m.blueScore : m.redScore;
      return { margin: ours - theirs, label: `${m.label} ${ours}-${theirs}` };
    });

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {d.robotTeam?.organization ?? "Team"}
            {d.robotTeam?.grade ? <Badge>{d.robotTeam.grade}</Badge> : null}
            {d.teamNumber === myTeam ? <Badge tone="accent">Your team</Badge> : null}
          </span>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-x-4">
            <span className="font-mono">{d.teamNumber}</span>
            {d.robotTeam?.team_name ? <span className="text-3xl text-muted sm:text-4xl">{d.robotTeam.team_name}</span> : null}
          </span>
        }
        actions={
          <>
            <span className="pill pill-soft">{formatLocation([d.robotTeam?.location?.city, d.robotTeam?.location?.region, d.robotTeam?.location?.country])}</span>
            <a href="#notes" className="pill pill-active">
              Notes · {d.notes.length}
            </a>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-8" title="Performance">
          {stats && stats.matches > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                <Stat label="TrueSkill" value={formatMetric(stats.trueskill)} sub={stats.rank ? `${ordinal(stats.rank)} of ${d.ratedTeams.toLocaleString()}` : undefined} size="lg" />
                <Stat label="Record" value={formatRecord(stats.wins, stats.losses, stats.ties)} sub={`${formatPercent(stats.winRate)} wins · ${stats.matches} played`} />
                <Stat label="OPR" value={formatMetric(stats.opr)} sub={`DPR ${formatMetric(stats.dpr)} · CCWM ${formatMetric(stats.ccwm)}`} />
                <Stat label="Skills PB" value={stats.skillsBest ?? "–"} sub={stats.skillsBest ? `Driver ${stats.skillsDriver} · Auton ${stats.skillsProgramming}` : "No skills runs"} />
              </div>
              {d.history.length > 1 ? (
                <div className="mt-8">
                  <p className="eyebrow mb-2">TrueSkill trend</p>
                  <StepChart values={d.history} />
                </div>
              ) : null}
            </>
          ) : (
            <Empty>No scored matches this season yet.</Empty>
          )}
        </Card>

        <div className="grid content-start gap-4 lg:col-span-4">
          {d.matchupVsMine !== null ? (
            <section className="rounded-[28px] bg-hero p-6 text-hero-ink">
              <p className="text-sm text-white/60">Head-to-head vs {myTeam}</p>
              <p className="display mt-3 text-6xl tabular-nums text-accent">{formatPercent(d.matchupVsMine)}</p>
              <p className="mt-3 text-sm text-white/70">
                Chance {myTeam} wins if the two teams meet, each with an average partner.
              </p>
            </section>
          ) : null}
          <Card title="Form">
            {form.length ? <FormChart points={form} /> : <Empty>No results yet.</Empty>}
          </Card>
        </div>

        <Card title="Matches this season" className="lg:col-span-8">
          {d.matches.length ? (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-20">Match</th>
                    <th className="w-32">Result</th>
                    <th>With</th>
                    <th>Against</th>
                  </tr>
                </thead>
                {groupByEvent(d.matches).map((group) => (
                  <tbody key={group.eventId}>
                    <tr>
                      <td colSpan={4} className="bg-surface-2/60 py-2">
                        <Link to={`/events/${group.eventId}`} className="block truncate text-xs font-medium text-ink-2 hover:underline">
                          {cleanName(group.eventName)}
                          <span className="font-normal text-muted"> · {formatShortDate(group.matches[group.matches.length - 1]?.time)}</span>
                        </Link>
                      </td>
                    </tr>
                    {group.matches.map((match) => {
                      const onRed = match.color === "red";
                      const partners = (onRed ? match.red : match.blue).filter((team) => team !== d.teamNumber);
                      const opponents = onRed ? match.blue : match.red;
                      return (
                        <tr key={match.id}>
                          <td className="font-mono">{match.label}</td>
                          <td>
                            {match.played ? (
                              <ResultPill ours={onRed ? match.redScore : match.blueScore} theirs={onRed ? match.blueScore : match.redScore} />
                            ) : (
                              <span className="text-sm text-muted">Not played · {formatShortDate(match.time)}</span>
                            )}
                          </td>
                          <td>
                            <span className="inline-flex flex-wrap gap-1">
                              {partners.length ? partners.map((team) => <TeamChip key={team} team={team} />) : <span className="text-muted">–</span>}
                            </span>
                          </td>
                          <td>
                            <span className="inline-flex flex-wrap gap-1">
                              {opponents.map((team) => (
                                <TeamChip key={team} team={team} />
                              ))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          ) : (
            <Empty>No matches indexed for this team yet.</Empty>
          )}
        </Card>

        <div className="grid content-start gap-4 lg:col-span-4">
          <Card title="Event results">
            {d.rankings.length ? (
              <ul className="flex flex-col gap-4">
                {d.rankings.map((row) => (
                  <li key={row.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <Link to={`/events/${row.eventId}`} className="line-clamp-1 text-sm font-medium hover:underline">
                        {cleanName(row.eventName)}
                      </Link>
                      <span className="font-mono text-sm">{row.rank ? ordinal(row.rank) : "–"}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted">
                      {row.record} · WP {row.wp} · AP {row.ap} · SP {row.sp}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No event rankings this season.</Empty>
            )}
          </Card>

          <Card title="Awards">
            {d.awards.length ? (
              <ul className="flex flex-col gap-3">
                {d.awards.map((award) => (
                  <li key={award.id} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-accent-strong" />
                    <span>
                      <span className="block text-sm font-medium">{award.title}</span>
                      <Link to={`/events/${award.eventId}`} className="line-clamp-1 text-xs text-muted hover:underline">
                        {cleanName(award.eventName)}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No awards yet this season.</Empty>
            )}
          </Card>

          {d.upcoming.length ? (
            <Card title="Upcoming">
              <ul className="flex flex-col gap-3">
                {d.upcoming.map((event) => (
                  <li key={event.id}>
                    <Link to={`/events/${event.id}`} className="line-clamp-1 text-sm font-medium hover:underline">
                      {cleanName(event.name)}
                    </Link>
                    <p className="text-xs text-muted">{formatDateRange(event.start, event.end)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <Card title="Scouting notes" className="lg:col-span-12">
          <div id="notes" className="grid scroll-mt-6 gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
            <Form method="post" className="flex flex-col gap-3" key={d.notes.length}>
              <input type="hidden" name="intent" value="add-note" />
              <input name="subject" className="field" placeholder="Subject (e.g. Auton consistency)" required maxLength={120} />
              <textarea name="strengths" className="field min-h-20" placeholder="Strengths" maxLength={2000} />
              <textarea name="concerns" className="field min-h-20" placeholder="Concerns" maxLength={2000} />
              <input name="author" className="field" placeholder="Your name (optional)" maxLength={60} />
              {actionData && !actionData.ok ? <p className="text-sm text-red">{actionData.error}</p> : null}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save note"}
              </button>
            </Form>

            {d.notes.length ? (
              <ul className="grid gap-3 md:grid-cols-2">
                {d.notes.map((note) => (
                  <li key={note.id} className="rounded-3xl bg-surface-2 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{note.subject}</p>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-note" />
                        <input type="hidden" name="noteId" value={note.id} />
                        <button type="submit" className="text-xs text-muted hover:text-red" aria-label={`Delete note ${note.subject}`}>
                          Delete
                        </button>
                      </Form>
                    </div>
                    {note.strengths ? (
                      <p className="mt-3 text-sm">
                        <span className="text-accent-strong">+ </span>
                        {note.strengths}
                      </p>
                    ) : null}
                    {note.concerns ? (
                      <p className="mt-2 text-sm">
                        <span className="text-red">− </span>
                        {note.concerns}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs text-muted">
                      {note.authorName} · {formatDate(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No notes yet. Add what you see in the pits and on the field — the whole team shares them.</Empty>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function groupByEvent<T extends { eventId: number; eventName: string }>(matches: T[]) {
  const groups: Array<{ eventId: number; eventName: string; matches: T[] }> = [];
  for (const match of matches) {
    const last = groups[groups.length - 1];
    if (last && last.eventId === match.eventId) last.matches.push(match);
    else groups.push({ eventId: match.eventId, eventName: match.eventName, matches: [match] });
  }
  return groups;
}

export function ErrorBoundary() {
  return (
    <div className="card mt-6">
      <h1 className="display text-5xl">Team not found</h1>
      <p className="mt-3 text-ink-2">RobotEvents has no V5RC team with that number.</p>
      <Link to="/" className="btn btn-primary mt-6">
        Back to overview
      </Link>
    </div>
  );
}
