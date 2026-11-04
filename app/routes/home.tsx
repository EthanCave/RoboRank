import { Link } from "react-router";

import type { Route } from "./+types/home";
import { FormChart, StepChart } from "../components/charts";
import { TeamChip } from "../components/team";
import { Badge, Card, CornerLink, Empty, HatchBar, PageHeader, ResultPill, Stat } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { formatDateRange, formatLocation, formatMetric, formatPercent, formatRecord, formatRelativeDay, formatShortDate, cleanName } from "../lib/format";
import { getTeamContext } from "../lib/my-team.server";
import { trueSkillHistory } from "../lib/ratings";
import { loadRatedMatches } from "../lib/season-sync.server";
import { countRatedTeams, getIndexedTeamMatches, getTeamStats, topTeams } from "../lib/stats.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Overview · RoboRank" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const team = user.teamCode;
  const context = await getTeamContext(team);

  const stats = getTeamStats(team);
  const matches = getIndexedTeamMatches(team).filter((m) => m.redScore + m.blueScore > 0);
  const history = stats?.matches ? trueSkillHistory(loadRatedMatches(), team).map((point) => point.trueskill) : [];
  const leaders = topTeams(8);
  const upcoming = context.events.filter((event) => (Date.parse(event.end ?? event.start ?? "") || 0) >= Date.now()).slice(0, 4);

  return {
    team,
    teamName: context.team?.team_name || context.team?.organization || null,
    location: context.team ? formatLocation([context.team.location?.city, context.team.location?.region]) : null,
    stats,
    ratedTeams: countRatedTeams(),
    history,
    recent: matches.slice(0, 14).map((match) => {
      const onRed = match.red.includes(team);
      const ours = onRed ? match.redScore : match.blueScore;
      const theirs = onRed ? match.blueScore : match.redScore;
      return {
        id: match.id,
        eventName: match.eventName,
        time: match.time,
        partners: (onRed ? match.red : match.blue).filter((t) => t !== team),
        opponents: onRed ? match.blue : match.red,
        ours,
        theirs,
        color: onRed ? ("red" as const) : ("blue" as const),
      };
    }),
    today: context.today,
    upcoming,
    leaders,
  };
}

export default function Home({ loaderData: data }: Route.ComponentProps) {
  const { stats } = data;
  const form = [...data.recent].reverse().map((m) => ({ margin: m.ours - m.theirs, label: `${m.ours}-${m.theirs} · ${m.eventName}` }));
  const topTs = data.leaders[0]?.trueskill ?? 1;
  const next = data.upcoming[0];

  return (
    <>
      <PageHeader
        eyebrow={data.teamName ? `${data.team} · ${data.teamName}${data.location ? ` · ${data.location}` : ""}` : `Team ${data.team}`}
        title="Overview"
        actions={
          <>
            <Link to={`/teams/${encodeURIComponent(data.team)}`} className="pill pill-soft">
              Scouting profile
            </Link>
            <Link to="/events?view=mine" className="pill pill-soft">
              Our events
            </Link>
          </>
        }
      />

      {data.today ? (
        <Link
          to="/competition"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[28px] bg-accent px-6 py-5 text-accent-ink"
        >
          <span>
            <span className="block text-sm opacity-70">Competing today</span>
            <span className="text-xl font-medium tracking-tight sm:text-2xl">{cleanName(data.today.name)}</span>
          </span>
          <span className="btn bg-ink text-canvas">Open competition mode →</span>
        </Link>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card title="Season rating" className="lg:col-span-7" action={<CornerLink to={`/teams/${encodeURIComponent(data.team)}`} label="Open team profile" />}>
          {stats && stats.matches > 0 ? (
            <div className="grid gap-8 md:grid-cols-[auto_1fr] md:items-end">
              <div>
                <div className="flex items-start gap-3">
                  <p className="display text-7xl tabular-nums sm:text-8xl">{formatMetric(stats.trueskill)}</p>
                  {stats.rank ? <Badge tone="accent">#{stats.rank} of {data.ratedTeams.toLocaleString()}</Badge> : null}
                </div>
                <p className="mt-3 text-sm text-muted">
                  TrueSkill · μ {formatMetric(stats.mu)} ± {formatMetric(stats.sigma)} over {stats.matches} matches
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 border-line md:border-l md:pl-8">
                <Stat label="Record" value={formatRecord(stats.wins, stats.losses, stats.ties)} sub={`${formatPercent(stats.winRate)} win rate`} />
                <Stat label="OPR" value={formatMetric(stats.opr)} sub={`CCWM ${formatMetric(stats.ccwm)}`} />
                <Stat label="Skills PB" value={stats.skillsBest ?? "–"} sub={stats.skillsBest ? `D ${stats.skillsDriver} · P ${stats.skillsProgramming}` : "No runs yet"} />
              </div>
            </div>
          ) : (
            <Empty>No scored matches for {data.team} this season yet. Ratings appear after the team's first event.</Empty>
          )}
          {data.history.length > 1 ? (
            <div className="mt-8">
              <p className="eyebrow mb-2">TrueSkill after each match</p>
              <StepChart values={data.history} />
            </div>
          ) : null}
        </Card>

        <section className="relative overflow-hidden rounded-[28px] bg-hero p-6 text-hero-ink lg:col-span-5">
          <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-accent opacity-25 blur-3xl" aria-hidden="true" />
          <div className="relative flex h-full flex-col">
            <span className="w-fit rounded-full border border-white/15 px-3 py-1 text-xs text-white/70">Next event</span>
            {next ? (
              <>
                <p className="display mt-6 text-6xl text-accent sm:text-7xl">{formatRelativeDay(next.start)}</p>
                <Link to={`/events/${next.id}`} className="mt-4 text-xl font-medium leading-snug tracking-tight hover:underline sm:text-2xl">
                  {cleanName(next.name)}
                </Link>
                <p className="mt-2 text-sm text-white/60">
                  {formatDateRange(next.start, next.end)} · {formatLocation([next.location?.city, next.location?.region])}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  <Link to={`/events/${next.id}`} className="btn btn-accent">
                    Scout the field
                  </Link>
                  <Link to={`/events/${next.id}/simulate`} className="btn border border-white/20 text-hero-ink">
                    Simulate
                  </Link>
                </div>
              </>
            ) : (
              <p className="mt-6 text-white/70">No upcoming events registered for {data.team} this season.</p>
            )}
          </div>
        </section>

        <Card title="Recent form" className="lg:col-span-7">
          {data.recent.length ? (
            <>
              <div className="pb-2">
                <FormChart points={form} />
              </div>
              <ul className="mt-6 divide-y divide-line">
                {data.recent.slice(0, 6).map((match) => (
                  <li key={match.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 py-3">
                    <ResultPill ours={match.ours} theirs={match.theirs} />
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted">
                      {match.partners.length ? (
                        <>
                          with
                          {match.partners.map((team) => (
                            <TeamChip key={team} team={team} />
                          ))}
                        </>
                      ) : null}
                      <span>vs</span>
                      {match.opponents.map((team) => (
                        <TeamChip key={team} team={team} />
                      ))}
                    </span>
                    <span className="text-xs text-muted">{formatShortDate(match.time)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Empty>Matches show up here after they are scored.</Empty>
          )}
        </Card>

        <Card title="World leaders" className="lg:col-span-5" action={<CornerLink to="/rankings" label="Full rankings" />}>
          {data.leaders.length ? (
            <ol className="flex flex-col gap-3">
              {data.leaders.map((leader, index) => (
                <li key={leader.teamNumber} className="grid grid-cols-[1.5rem_5.5rem_1fr_3.5rem] items-center gap-3">
                  <span className="font-mono text-sm text-muted">{index + 1}</span>
                  <TeamChip team={leader.teamNumber} />
                  <HatchBar value={leader.trueskill / topTs} tone={index === 0 ? "accent" : "ink"} label={`${leader.teamNumber} TrueSkill`} />
                  <span className="text-right font-mono text-sm">{formatMetric(leader.trueskill)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>Ratings appear once the season index finishes its first sync.</Empty>
          )}
        </Card>

        {data.upcoming.length > 1 ? (
          <Card title="Coming up" className="lg:col-span-12">
            <div className="grid gap-3 md:grid-cols-3">
              {data.upcoming.slice(1).map((event) => (
                <Link key={event.id} to={`/events/${event.id}`} className="rounded-3xl bg-surface-2 p-5 hover:bg-line/60">
                  <p className="font-mono text-xs text-muted">{event.sku}</p>
                  <p className="mt-2 line-clamp-2 font-medium">{cleanName(event.name)}</p>
                  <p className="mt-3 text-sm text-muted">
                    {formatDateRange(event.start, event.end)} · {formatRelativeDay(event.start)}
                  </p>
                </Link>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
