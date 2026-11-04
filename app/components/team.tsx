import { Link, useRouteLoaderData } from "react-router";

import { cx } from "./ui";

/** The signed-in team code, from the app-shell loader. */
export function useMyTeam(): string {
  const data = useRouteLoaderData("routes/app-shell") as { user?: { teamCode: string } } | undefined;
  return data?.user?.teamCode ?? "";
}

export function TeamChip({ team, tone, className }: { team: string; tone?: "red" | "blue"; className?: string }) {
  const mine = useMyTeam() === team;
  return (
    <Link
      to={`/teams/${encodeURIComponent(team)}`}
      className={cx("chip hover:opacity-80", mine ? "chip-mine" : tone === "red" ? "chip-red" : tone === "blue" ? "chip-blue" : null, className)}
    >
      {team}
    </Link>
  );
}

export function AllianceChips({ teams, tone }: { teams: string[]; tone: "red" | "blue" }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {teams.map((team) => (
        <TeamChip key={team} team={team} tone={tone} />
      ))}
    </span>
  );
}
