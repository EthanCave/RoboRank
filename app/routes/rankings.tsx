import { Link } from "react-router";

import type { Route } from "./+types/rankings";
import { TeamChip, useMyTeam } from "../components/team";
import { Card, Empty, HatchBar, PageHeader, Segmented } from "../components/ui";
import { requireUser } from "../lib/auth.server";
import { getDb } from "../lib/db.server";
import { formatMetric, formatPercent, formatRecord } from "../lib/format";
import { getSyncStatus } from "../lib/season-sync.server";
import { getTeamStats } from "../lib/stats.server";

type By = "trueskill" | "opr" | "ccwm" | "skills";

const ORDER: Record<By, string> = {
  trueskill: "trueskill DESC",
  opr: "opr DESC",
  ccwm: "ccwm DESC",
  skills: "skills_best DESC",
};

const LABEL: Record<By, string> = { trueskill: "TrueSkill", opr: "OPR", ccwm: "CCWM", skills: "Skills" };

export function meta(_: Route.MetaArgs) {
  return [{ title: "Rankings · RoboRank" }];
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const by = (Object.keys(ORDER).includes(url.searchParams.get("by") ?? "") ? url.searchParams.get("by") : "trueskill") as By;
  const minMatches = by === "skills" ? 0 : 6;
  const filter = by === "skills" ? "skills_best IS NOT NULL" : `matches >= ${minMatches}${by === "trueskill" ? "" : ` AND ${by} IS NOT NULL`}`;

  const rows = getDb()
    .prepare(
      `SELECT team_number, trueskill, mu, sigma, matches, wins, losses, ties, opr, ccwm, skills_best, skills_driver, skills_programming
       FROM team_ratings WHERE ${filter} ORDER BY ${ORDER[by]} LIMIT 100`,
    )
    .all() as Array<{
    team_number: string;
    trueskill: number;
    matches: number;
    wins: number;
    losses: number;
    ties: number;
    opr: number | null;
    ccwm: number | null;
    skills_best: number | null;
    skills_driver: number | null;
    skills_programming: number | null;
  }>;

  const value = (row: (typeof rows)[number]) =>
    by === "trueskill" ? row.trueskill : by === "opr" ? row.opr : by === "ccwm" ? row.ccwm : row.skills_best;
  const mine = getTeamStats(user.teamCode);
  const myValue = !mine ? null : by === "trueskill" ? (mine.matches >= minMatches ? mine.trueskill : null) : by === "opr" ? mine.opr : by === "ccwm" ? mine.ccwm : mine.skillsBest;
  const myPosition =
    myValue !== null && myValue !== undefined
      ? (getDb()
          .prepare(`SELECT COUNT(*) + 1 AS n FROM team_ratings WHERE ${filter} AND ${by === "skills" ? "skills_best" : by} > ?`)
          .get(myValue) as { n: number }).n
      : null;

  return {
    by,
    minMatches,
    myPosition,
    lastSyncedAt: getSyncStatus().lastSyncedAt,
    rows: rows.map((row) => ({
      team: row.team_number,
      value: value(row),
      trueskill: row.trueskill,
      record: formatRecord(row.wins, row.losses, row.ties),
      winRate: row.matches ? (row.wins + row.ties / 2) / row.matches : null,
      opr: row.opr,
      ccwm: row.ccwm,
      skills: row.skills_best,
      skillsSplit: row.skills_best ? `${row.skills_driver} / ${row.skills_programming}` : null,
    })),
  };
}

export default function RankingsPage({ loaderData: d }: Route.ComponentProps) {
  const myTeam = useMyTeam();
  const max = Math.max(...d.rows.map((row) => row.value ?? 0), 1);

  return (
    <>
      <PageHeader
        eyebrow={d.lastSyncedAt ? `Season to date · updated ${new Date(d.lastSyncedAt).toLocaleString()}` : "Season to date"}
        title="Rankings"
        actions={
          <Segmented items={(Object.keys(LABEL) as By[]).map((by) => ({ to: `/rankings?by=${by}`, label: LABEL[by], active: d.by === by }))} />
        }
      />

      {d.myPosition ? (
        <p className="mb-4 text-sm text-muted">
          <Link to={`/teams/${encodeURIComponent(myTeam)}`} className="chip chip-mine mr-2">
            {myTeam}
          </Link>
          is #{d.myPosition.toLocaleString()} by {LABEL[d.by]}.
        </p>
      ) : null}

      <Card>
        {d.rows.length ? (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="min-w-48">{LABEL[d.by]}</th>
                  <th className="num">TrueSkill</th>
                  <th className="num">Record</th>
                  <th className="num">Win %</th>
                  <th className="num">OPR</th>
                  <th className="num">CCWM</th>
                  <th className="num">Skills (D / A)</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((row, index) => (
                  <tr key={row.team}>
                    <td className="font-mono text-muted">{index + 1}</td>
                    <td>
                      <TeamChip team={row.team} />
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="w-12 font-mono">{d.by === "skills" ? (row.value ?? "–") : formatMetric(row.value)}</span>
                        <div className="w-32">
                          <HatchBar value={(row.value ?? 0) / max} tone={row.team === myTeam ? "accent" : "ink"} />
                        </div>
                      </div>
                    </td>
                    <td className="num">{formatMetric(row.trueskill)}</td>
                    <td className="num">{row.record}</td>
                    <td className="num">{formatPercent(row.winRate)}</td>
                    <td className="num">{formatMetric(row.opr)}</td>
                    <td className="num">{formatMetric(row.ccwm)}</td>
                    <td className="num">{row.skills ? `${row.skills} (${row.skillsSplit})` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.by !== "skills" ? <p className="mt-3 text-xs text-muted">Teams with at least {d.minMatches} scored matches.</p> : null}
          </div>
        ) : (
          <Empty>Rankings fill in once the season index finishes syncing.</Empty>
        )}
      </Card>
    </>
  );
}
