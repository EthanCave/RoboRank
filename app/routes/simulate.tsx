import { data, Link } from "react-router";

import type { Route } from "./+types/simulate";
import { TeamChip, useMyTeam } from "../components/team";
import { Badge, Card, Empty, HatchBar, PageHeader, Stat } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { formatMetric, formatPercent, cleanName } from "../lib/format";
import { getRobotEventById, listRobotEventMatches, listRobotEventTeams } from "../lib/robotevents.server";
import { simulateEvent, type SimMatch, type SimTeam } from "../lib/simulation";
import { getStatsForTeams } from "../lib/stats.server";
import { allianceScore, allianceTeams, normalizeTeamNumber } from "../lib/teams";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Simulate ${loaderData?.event.sku ?? "event"} · RoboRank` }];
}

const ITERATIONS = 500;

export async function loader({ request, params, url }: Route.LoaderArgs) {
  await requireUser(request);
  const event = await getRobotEventById(Number(params.eventId)).catch(() => null);
  if (!event) throw data(null, { status: 404 });

  const seed = Math.max(1, Math.floor(Number(url.searchParams.get("seed")) || 1));
  const started = (Date.parse(event.start ?? "") || Infinity) <= Date.now() + 12 * 60 * 60 * 1000;
  const [teams, matches] = await Promise.all([
    listRobotEventTeams(event.id).catch(() => []),
    started ? listRobotEventMatches(event.id).catch(() => []) : Promise.resolve([]),
  ]);

  const numbers = teams.map((team) => normalizeTeamNumber(team.number)).filter(Boolean);
  const stats = getStatsForTeams(numbers);
  const oprs = [...stats.values()].map((s) => s.opr).filter((v): v is number => v !== null);
  const fieldOpr = oprs.length ? oprs.reduce((a, b) => a + b, 0) / oprs.length : 10;

  const simTeams: SimTeam[] = numbers.map((teamNumber) => {
    const s = stats.get(teamNumber);
    return { teamNumber, mu: s?.mu ?? 25, sigma: s?.sigma ?? 25 / 3, opr: s?.opr ?? fieldOpr };
  });

  // Use the published qualification schedule when there is one (single-division events only),
  // keeping matches that have already been played.
  const divisions = new Set(matches.map((m) => m.division?.id ?? 1));
  const schedule: SimMatch[] =
    divisions.size <= 1
      ? matches
          .filter((m) => m.round === 2)
          .map((m) => {
            const redScore = allianceScore(m, "red") ?? 0;
            const blueScore = allianceScore(m, "blue") ?? 0;
            return {
              id: m.id,
              red: allianceTeams(m, "red"),
              blue: allianceTeams(m, "blue"),
              result: redScore + blueScore > 0 ? { redScore, blueScore } : undefined,
            };
          })
          .filter((m) => m.red.length && m.blue.length && m.red.concat(m.blue).every((team) => numbers.includes(team)))
      : [];

  const result = simulateEvent({ teams: simTeams, schedule, iterations: ITERATIONS, seed });

  return {
    event: { id: event.id, sku: event.sku, name: event.name },
    seed,
    unrated: simTeams.filter((team) => !stats.get(team.teamNumber)?.matches).length,
    result,
  };
}

export default function SimulatePage({ loaderData: d }: Route.ComponentProps) {
  const myTeam = useMyTeam();
  const r = d.result;
  const mine = r?.odds.find((row) => row.teamNumber === myTeam);
  const topChampion = r?.odds[0]?.champion || 1;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to={`/events/${d.event.id}`} className="hover:underline">
            ← {cleanName(d.event.name)}
          </Link>
        }
        title="Simulation"
        actions={
          <>
            <span className="pill pill-soft font-mono">Seed {d.seed}</span>
            <Link to={`/events/${d.event.id}/simulate?seed=${d.seed + 1}`} className="btn btn-primary" preventScrollReset>
              Re-run
            </Link>
          </>
        }
      />

      {!r ? (
        <Empty>This event needs at least four registered teams to simulate.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-2 gap-4 lg:col-span-12 lg:grid-cols-4">
            <div className="card">
              <Stat label="Runs" value={r.iterations} sub={`${r.allianceCount} alliances`} />
            </div>
            <div className="card">
              <Stat
                label="Qualification schedule"
                value={r.usedRealSchedule ? `${r.playedMatches}/${r.totalMatches}` : r.totalMatches}
                sub={r.usedRealSchedule ? "played / scheduled (real schedule)" : "generated matches"}
              />
            </div>
            <div className="card">
              <Stat label="Favorite" value={r.odds[0]?.teamNumber ?? "–"} sub={`${formatPercent(r.odds[0]?.champion)} to win`} />
            </div>
            <div className="card">
              {mine ? (
                <Stat label={`${myTeam} odds`} value={formatPercent(mine.champion)} sub={`avg rank ${formatMetric(mine.avgRank)} · captain ${formatPercent(mine.captain)}`} />
              ) : (
                <Stat label="Unrated teams" value={d.unrated} sub="simulated at the prior (μ 25)" />
              )}
            </div>
          </div>

          <Card title="Championship odds" className="lg:col-span-7">
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th className="min-w-44">Win event</th>
                    <th className="num">Top 4</th>
                    <th className="num">Captain</th>
                    <th className="num">Avg rank</th>
                  </tr>
                </thead>
                <tbody>
                  {r.odds.slice(0, 24).map((row) => (
                    <tr key={row.teamNumber}>
                      <td>
                        <TeamChip team={row.teamNumber} />
                      </td>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="w-12 font-mono">{formatPercent(row.champion, 1)}</span>
                          <div className="w-28">
                            <HatchBar value={row.champion / topChampion} tone={row.teamNumber === myTeam ? "accent" : "ink"} />
                          </div>
                        </div>
                      </td>
                      <td className="num">{formatPercent(row.top4)}</td>
                      <td className="num">{formatPercent(row.captain)}</td>
                      <td className="num">{formatMetric(row.avgRank)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid content-start gap-4 lg:col-span-5">
            <section className="rounded-[28px] bg-hero p-6 text-hero-ink">
              <p className="text-sm text-white/60">Sample run champion</p>
              <p className="display mt-3 font-mono text-5xl text-accent">{r.sample.champion?.teams.join(" + ") ?? "–"}</p>
              <p className="mt-3 text-sm text-white/70">Alliance #{r.sample.champion?.seed} in one simulated bracket. Re-run to see another outcome.</p>
            </section>

            <Card title="Sample alliance selection">
              <ol className="grid grid-cols-2 gap-2">
                {r.sample.alliances.map((alliance) => (
                  <li key={alliance.seed} className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2">
                    <span className="w-6 font-mono text-xs text-muted">{alliance.seed}</span>
                    <span className="flex flex-wrap gap-1">
                      {alliance.teams.map((team) => (
                        <TeamChip key={team} team={team} />
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <Card title="Sample bracket" className="lg:col-span-12">
            <div className="scroll-x flex gap-4">
              {[...new Set(r.sample.bracket.map((game) => game.round))].map((round, index, rounds) => (
                <div key={round} className="flex min-w-44 flex-col justify-around gap-2">
                  <p className="eyebrow">{roundName(rounds.length - index)}</p>
                  {r.sample.bracket
                    .filter((game) => game.round === round)
                    .map((game, i) => (
                      <div key={i} className="rounded-2xl bg-surface-2 p-2 font-mono text-sm">
                        {[game.redSeed, game.blueSeed].map((seed, slot) => (
                          <div key={slot} className={seed && seed === game.winnerSeed ? "flex justify-between rounded-xl bg-surface px-2 py-1 font-semibold" : "flex justify-between px-2 py-1 text-muted"}>
                            <span>{seed ? `#${seed}` : "bye"}</span>
                            <span className="truncate pl-2">{seed ? r.sample.alliances.find((a) => a.seed === seed)?.teams.join(" ") : ""}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Sample qualification standings" className="lg:col-span-12">
            <div className="flex flex-wrap gap-2">
              {r.sample.standings.slice(0, 32).map((row) => (
                <span key={row.teamNumber} className="inline-flex items-center gap-2 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
                  <span className="font-mono text-xs text-muted">{row.rank}</span>
                  <TeamChip team={row.teamNumber} />
                  <Badge>
                    {row.wins}-{row.losses}-{row.ties}
                  </Badge>
                </span>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function roundName(remaining: number) {
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinals";
  if (remaining === 3) return "Quarterfinals";
  return `Round of ${2 ** remaining}`;
}
