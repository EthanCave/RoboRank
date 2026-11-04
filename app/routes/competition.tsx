import { useEffect } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";

import type { Route } from "./+types/competition";
import { TeamChip, useMyTeam } from "../components/team";
import { Badge, Card, Empty, PageHeader, Stat, WinProbBar } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { formatDateRange, formatMetric, formatPercent, formatRelativeDay, formatTime, ordinal, cleanName } from "../lib/format";
import { getTeamContext } from "../lib/my-team.server";
import { listMatchNotes, saveMatchNote } from "../lib/notes.server";
import { computeSkillsBests } from "../lib/ratings";
import { getRobotEventById, listRobotEventMatches, listRobotEventRankings, listRobotEventSkills, type RobotEvent } from "../lib/robotevents.server";
import { getStatsForTeams, predictRedWin, predictScore } from "../lib/stats.server";
import { allianceScore, allianceTeams, matchLabel, normalizeTeamNumber } from "../lib/teams";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Competition · RoboRank" }];
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const team = user.teamCode;
  const context = await getTeamContext(team);
  const requested = Number(url.searchParams.get("event")) || null;

  let event: RobotEvent | null = context.today;
  if (requested) event = await getRobotEventById(requested).catch(() => null);

  const upcoming = context.events
    .filter((e) => (Date.parse(e.end ?? e.start ?? "") || 0) >= Date.now() - 2 * 86_400_000)
    .map((e) => ({ id: e.id, name: e.name, start: e.start ?? null, end: e.end ?? null }));

  if (!event) {
    return { team, event: null, upcoming, isToday: false, matches: [], next: null, ranking: null, topRankings: [], skills: [], mySkills: null };
  }

  const [rawMatches, rankings, skillRows] = await Promise.all([
    listRobotEventMatches(event.id).catch(() => []),
    listRobotEventRankings(event).catch(() => []),
    listRobotEventSkills(event.id).catch(() => []),
  ]);

  const mine = rawMatches
    .map((match) => ({
      id: match.id,
      round: match.round ?? 0,
      instance: match.instance ?? 0,
      matchnum: match.matchnum ?? 0,
      time: match.started ?? match.scheduled ?? null,
      field: match.field ?? null,
      red: allianceTeams(match, "red"),
      blue: allianceTeams(match, "blue"),
      redScore: allianceScore(match, "red") ?? 0,
      blueScore: allianceScore(match, "blue") ?? 0,
    }))
    .filter((match) => match.red.includes(team) || match.blue.includes(team))
    .sort((a, b) => a.round - b.round || a.instance - b.instance || a.matchnum - b.matchnum);

  const stats = getStatsForTeams(mine.flatMap((m) => [...m.red, ...m.blue]));
  const oprs = [...stats.values()].map((s) => s.opr).filter((v): v is number => v !== null);
  const fieldOpr = oprs.length ? oprs.reduce((a, b) => a + b, 0) / oprs.length : 10;
  const notes = listMatchNotes(event.id, team);
  const describe = (t: string) => ({ team: t, trueskill: stats.get(t)?.trueskill ?? null, opr: stats.get(t)?.opr ?? null });

  const matches = mine.map((match) => {
    const onRed = match.red.includes(team);
    const pRed = predictRedWin(match.red, match.blue, stats);
    return {
      ...match,
      label: matchLabel(match),
      color: onRed ? ("red" as const) : ("blue" as const),
      played: match.redScore + match.blueScore > 0,
      winChance: onRed ? pRed : 1 - pRed,
      redWin: pRed,
      redPred: Math.round(predictScore(match.red, stats, fieldOpr)),
      bluePred: Math.round(predictScore(match.blue, stats, fieldOpr)),
      partners: (onRed ? match.red : match.blue).filter((t) => t !== team).map(describe),
      opponents: (onRed ? match.blue : match.red).map(describe),
      note: notes.get(match.id) ?? "",
    };
  });

  const rankingRows = rankings
    .map((row) => ({
      team: normalizeTeamNumber(row.team?.name),
      rank: row.rank ?? 0,
      record: `${row.wins ?? 0}-${row.losses ?? 0}-${row.ties ?? 0}`,
      wp: row.wp ?? 0,
      ap: row.ap ?? 0,
      sp: row.sp ?? 0,
    }))
    .sort((a, b) => a.rank - b.rank);

  const eventId = event.id;
  const skillBests = [
    ...computeSkillsBests(
      skillRows
        .filter((row) => row.team?.name && typeof row.score === "number" && row.type)
        .map((row) => ({ eventId, teamNumber: normalizeTeamNumber(row.team!.name), type: row.type!, score: row.score! })),
    ).values(),
  ].sort((a, b) => b.combined - a.combined);
  const mySkillsIndex = skillBests.findIndex((row) => row.teamNumber === team);

  return {
    team,
    event: { id: event.id, name: event.name, sku: event.sku, start: event.start ?? null, end: event.end ?? null },
    upcoming,
    isToday: context.today?.id === event.id,
    matches,
    // Once the event is over, unplayed matches are forfeits/cancellations, not "next".
    next: (Date.parse(event.end ?? event.start ?? "") || 0) + 86_400_000 >= Date.now() ? (matches.find((m) => !m.played) ?? null) : null,
    ranking: rankingRows.find((row) => row.team === team) ?? null,
    topRankings: rankingRows.slice(0, 10),
    skills: skillBests.slice(0, 10),
    mySkills: mySkillsIndex >= 0 ? { ...skillBests[mySkillsIndex], position: mySkillsIndex + 1 } : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  try {
    saveMatchNote({
      eventId: Number(form.get("eventId")),
      matchId: Number(form.get("matchId")),
      teamNumber: user.teamCode,
      authorName: user.teamCode,
      note: String(form.get("note") ?? ""),
    });
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Could not save." };
  }
}

function MatchNote({ eventId, matchId, note }: { eventId: number; matchId: number; note: string }) {
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="matchId" value={matchId} />
      <label className="sr-only" htmlFor={`note-${matchId}`}>
        Match notes
      </label>
      <textarea
        id={`note-${matchId}`}
        name="note"
        defaultValue={note}
        rows={2}
        placeholder="Strategy, auton plan, who plays defense…"
        className="field min-h-12 flex-1 text-sm"
        maxLength={2000}
      />
      <button type="submit" className="btn btn-quiet" disabled={saving}>
        {saving ? "Saving…" : fetcher.data?.ok ? "Saved" : "Save"}
      </button>
      {fetcher.data && !fetcher.data.ok ? <p className="text-sm text-red">{fetcher.data.error}</p> : null}
    </fetcher.Form>
  );
}

function TeamLine({ entries, tone }: { entries: Array<{ team: string; trueskill: number | null; opr: number | null }>; tone: "red" | "blue" }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {entries.map((entry) => (
        <span key={entry.team} className="inline-flex items-center gap-1.5">
          <TeamChip team={entry.team} tone={tone} />
          <span className="font-mono text-xs text-muted">
            TS {formatMetric(entry.trueskill)} · OPR {formatMetric(entry.opr)}
          </span>
        </span>
      ))}
    </span>
  );
}

export default function CompetitionPage({ loaderData: d }: Route.ComponentProps) {
  const myTeam = useMyTeam();
  const revalidator = useRevalidator();
  const hasEvent = Boolean(d.event);

  // Match-day freshness: refresh scores and rankings every minute while the tab is visible.
  useEffect(() => {
    if (!hasEvent) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") revalidator.revalidate();
    }, 60_000);
    return () => clearInterval(id);
  }, [hasEvent, revalidator]);

  if (!d.event) {
    return (
      <>
        <PageHeader eyebrow={`Team ${d.team}`} title="Competition" />
        <Card title="No event today">
          <p className="text-ink-2">
            Competition mode lights up on days {d.team} is registered for an event. You can also open it for any of your events to prepare.
          </p>
          {d.upcoming.length ? (
            <ul className="mt-6 grid gap-3 md:grid-cols-2">
              {d.upcoming.map((event) => (
                <li key={event.id}>
                  <Link to={`/competition?event=${event.id}`} className="block rounded-3xl bg-surface-2 p-5 hover:bg-line/60">
                    <p className="font-medium">{cleanName(event.name)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {formatDateRange(event.start, event.end)} · {formatRelativeDay(event.start)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-6">
              <Empty>No upcoming events registered for {d.team}.</Empty>
            </div>
          )}
        </Card>
      </>
    );
  }

  const eventId = d.event.id;
  const next = d.next;
  const played = d.matches.filter((m) => m.played);
  const record = played.reduce(
    (acc, m) => {
      const ours = m.color === "red" ? m.redScore : m.blueScore;
      const theirs = m.color === "red" ? m.blueScore : m.redScore;
      if (ours > theirs) acc.w += 1;
      else if (ours < theirs) acc.l += 1;
      else acc.t += 1;
      return acc;
    },
    { w: 0, l: 0, t: 0 },
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {d.isToday ? <Badge tone="accent">Live today</Badge> : <Badge>Preview</Badge>}
            <Link to={`/events/${eventId}`} className="font-mono hover:underline">
              {d.event.sku}
            </Link>
          </span>
        }
        title={<span className="block max-w-5xl text-3xl leading-tight sm:text-4xl md:text-5xl">{cleanName(d.event.name)}</span>}
        actions={
          <button type="button" className="btn btn-quiet" onClick={() => revalidator.revalidate()} disabled={revalidator.state !== "idle"}>
            {revalidator.state !== "idle" ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <section className="rounded-[28px] bg-accent p-6 text-accent-ink lg:col-span-7">
          {next ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-black/10 px-3 py-1 text-sm">Next match</span>
                <span className="text-sm opacity-70">
                  {formatTime(next.time)}
                  {next.field ? ` · ${next.field}` : ""}
                </span>
              </div>
              <p className="display mt-5 font-mono text-7xl sm:text-8xl">{next.label}</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm opacity-70">With</p>
                  <p className="mt-1 font-mono text-2xl">{next.partners.map((p) => p.team).join(", ") || "–"}</p>
                </div>
                <div>
                  <p className="text-sm opacity-70">Against</p>
                  <p className="mt-1 font-mono text-2xl">{next.opponents.map((p) => p.team).join(", ")}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm opacity-70">Win chance</p>
                  <p className="display text-5xl tabular-nums">{formatPercent(next.winChance)}</p>
                </div>
                <p className="font-mono text-sm opacity-70">
                  Projected {next.color === "red" ? next.redPred : next.bluePred}–{next.color === "red" ? next.bluePred : next.redPred}
                </p>
              </div>
            </>
          ) : (
            <>
              <span className="rounded-full bg-black/10 px-3 py-1 text-sm">Schedule</span>
              <p className="display mt-5 text-5xl">{d.matches.length ? "All matches played" : "No matches yet"}</p>
              <p className="mt-3 opacity-70">
                {d.matches.length ? "Check rankings and plan alliance selection." : "The qualification schedule appears here once it's published."}
              </p>
            </>
          )}
        </section>

        <div className="grid grid-cols-2 gap-4 lg:col-span-5">
          <div className="card">
            <Stat label="Rank" value={d.ranking ? ordinal(d.ranking.rank) : "–"} sub={d.ranking ? `WP ${d.ranking.wp} · AP ${d.ranking.ap} · SP ${d.ranking.sp}` : "Not ranked yet"} />
          </div>
          <div className="card">
            <Stat label="Record here" value={`${record.w}-${record.l}-${record.t}`} sub={`${played.length} of ${d.matches.length} played`} />
          </div>
          <div className="card col-span-2">
            <Stat
              label="Skills at this event"
              value={d.mySkills ? d.mySkills.combined : "–"}
              sub={d.mySkills ? `${ordinal(d.mySkills.position)} · Driver ${d.mySkills.driver} · Auton ${d.mySkills.programming}` : "No runs yet"}
            />
          </div>
        </div>

        <Card title={`Our matches · ${d.matches.length}`} className="lg:col-span-8">
          {d.matches.length ? (
            <ul className="flex flex-col gap-3">
              {d.matches.map((match) => {
                const ours = match.color === "red" ? match.redScore : match.blueScore;
                const theirs = match.color === "red" ? match.blueScore : match.redScore;
                return (
                  <li key={match.id} className={match.id === next?.id ? "rounded-3xl border-2 border-accent-strong p-4" : "rounded-3xl bg-surface-2 p-4"}>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="font-mono text-lg">{match.label}</span>
                      <Badge tone={match.color}>{match.color}</Badge>
                      {match.played ? (
                        <span className={ours > theirs ? "font-mono text-accent-strong" : ours < theirs ? "font-mono text-red" : "font-mono"}>
                          {ours > theirs ? "W" : ours < theirs ? "L" : "T"} {ours}–{theirs}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">{formatTime(match.time)}</span>
                      )}
                      <span className="w-full sm:ml-auto sm:w-56">
                        <WinProbBar red={match.redWin} />
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-20 text-muted">Partner</span>
                        {match.partners.length ? <TeamLine entries={match.partners} tone={match.color} /> : <span className="text-muted">–</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-20 text-muted">Opponents</span>
                        <TeamLine entries={match.opponents} tone={match.color === "red" ? "blue" : "red"} />
                      </div>
                    </div>
                    <MatchNote eventId={eventId} matchId={match.id} note={match.note} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>No matches for {myTeam} at this event yet.</Empty>
          )}
        </Card>

        <div className="grid content-start gap-4 lg:col-span-4">
          <Card title="Rankings">
            {d.topRankings.length ? (
              <ol className="flex flex-col gap-2">
                {d.topRankings.map((row) => (
                  <li key={row.team} className="flex items-center gap-3">
                    <span className="w-6 font-mono text-sm text-muted">{row.rank}</span>
                    <TeamChip team={row.team} />
                    <span className="ml-auto font-mono text-xs text-muted">
                      {row.record} · {row.wp} WP
                    </span>
                  </li>
                ))}
                {d.ranking && d.ranking.rank > 10 ? (
                  <li className="flex items-center gap-3 border-t border-line pt-2">
                    <span className="w-6 font-mono text-sm text-muted">{d.ranking.rank}</span>
                    <TeamChip team={d.ranking.team} />
                    <span className="ml-auto font-mono text-xs text-muted">{d.ranking.record}</span>
                  </li>
                ) : null}
              </ol>
            ) : (
              <Empty>Rankings appear after the first qualification matches.</Empty>
            )}
          </Card>

          <Card title="Skills leaders">
            {d.skills.length ? (
              <ol className="flex flex-col gap-2">
                {d.skills.map((row, index) => (
                  <li key={row.teamNumber} className="flex items-center gap-3">
                    <span className="w-6 font-mono text-sm text-muted">{index + 1}</span>
                    <TeamChip team={row.teamNumber} />
                    <span className="ml-auto font-mono text-sm">{row.combined}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No skills runs yet.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
