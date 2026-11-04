import type { RobotMatch } from "./robotevents.server";

type AllianceSnapshot = {
  teams: string[];
  score: number | null;
};

export type MatchPrediction = {
  matchId: number;
  label: string;
  scheduled: string | null;
  red: AllianceSnapshot;
  blue: AllianceSnapshot;
  redWinProbability: number;
  winner: "Red" | "Blue";
};

function cleanTeamNumber(raw: string) {
  return raw.trim().toUpperCase();
}

function asAlliance(match: RobotMatch, color: "red" | "blue"): AllianceSnapshot {
  const alliance = match.alliances?.find((entry) => {
    return entry.color?.toLowerCase() === color;
  });

  const teams =
    alliance?.teams
      ?.map((entry) => entry.team?.number)
      .filter((number): number is string => typeof number === "string" && number.trim().length > 0)
      .map(cleanTeamNumber) ?? [];

  return {
    teams,
    score: typeof alliance?.score === "number" ? alliance.score : null,
  };
}

export function buildTrueSkillMap(rows: Array<{ teamNumber: string; trueskill: number | null }>) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    if (typeof row.trueskill === "number") {
      acc[row.teamNumber.toUpperCase()] = row.trueskill;
    }
    return acc;
  }, {});
}

function totalTrueSkill(teamNumbers: string[], trueSkillMap: Record<string, number>) {
  return teamNumbers.reduce((total, number) => {
    return total + (trueSkillMap[number] ?? 20);
  }, 0);
}

function logisticProbability(left: number, right: number) {
  return 1 / (1 + Math.exp(-(left - right) / 5));
}

function matchLabel(match: RobotMatch) {
  if (match.name?.trim()) return match.name;

  const round = typeof match.round === "number" ? `R${match.round}` : "R?";
  const instance = typeof match.instance === "number" ? `I${match.instance}` : "I?";
  const number = typeof match.matchnum === "number" ? `M${match.matchnum}` : "M?";
  return `${round}-${instance}-${number}`;
}

export function predictMatches(
  matches: RobotMatch[],
  trueSkillMap: Record<string, number>,
  limit = 12,
): MatchPrediction[] {
  return matches
    .map((match) => {
      const red = asAlliance(match, "red");
      const blue = asAlliance(match, "blue");

      if (!red.teams.length || !blue.teams.length) {
        return null;
      }

      const redStrength = totalTrueSkill(red.teams, trueSkillMap);
      const blueStrength = totalTrueSkill(blue.teams, trueSkillMap);
      const redWinProbability = logisticProbability(redStrength, blueStrength);

      return {
        matchId: match.id,
        label: matchLabel(match),
        scheduled: match.scheduled ?? null,
        red,
        blue,
        redWinProbability,
        winner: redWinProbability >= 0.5 ? "Red" : "Blue",
      } satisfies MatchPrediction;
    })
    .filter((row): row is MatchPrediction => Boolean(row))
    .sort((a, b) => {
      const left = Date.parse(a.scheduled ?? "") || Number.MAX_SAFE_INTEGER;
      const right = Date.parse(b.scheduled ?? "") || Number.MAX_SAFE_INTEGER;
      return left - right;
    })
    .slice(0, limit);
}
