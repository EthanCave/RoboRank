import type { MatchAlliance, RobotMatch } from "./robotevents.server";

export function normalizeTeamNumber(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

/** Team numbers on one alliance of a RobotEvents match (the number lives in `team.name`). */
export function allianceTeams(match: Pick<RobotMatch, "alliances">, color: "red" | "blue"): string[] {
  const alliance: MatchAlliance | undefined = match.alliances?.find((entry) => entry.color?.toLowerCase() === color);
  return (
    alliance?.teams
      ?.filter((entry) => !entry.sitting)
      .map((entry) => normalizeTeamNumber(entry.team?.name))
      .filter(Boolean) ?? []
  );
}

export function allianceScore(match: Pick<RobotMatch, "alliances">, color: "red" | "blue"): number | null {
  const score = match.alliances?.find((entry) => entry.color?.toLowerCase() === color)?.score;
  return typeof score === "number" ? score : null;
}

const ROUND_PREFIX: Record<number, string> = {
  1: "P",
  2: "Q",
  3: "QF",
  4: "SF",
  5: "F",
  6: "R16",
};

/** Short label like "Q12", "SF 2-1" or "F 1". */
export function matchLabel(match: { round: number; instance: number; matchnum: number }) {
  const prefix = ROUND_PREFIX[match.round] ?? `R${match.round}`;
  if (match.round === 2 || match.round === 1) return `${prefix}${match.matchnum}`;
  return `${prefix} ${match.instance}-${match.matchnum}`;
}
