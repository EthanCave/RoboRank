import type { Route } from "./+types/team-quick-stats";
import { requireUser } from "../lib/auth.server";
import { getRobotTeamByNumber } from "../lib/robotevents.server";
import { getVrcTeamProfile } from "../lib/vrc-data.server";

type JsonMap = Record<string, unknown>;

function normalizeTeamNumber(teamNumber: string) {
  return teamNumber.trim().toUpperCase();
}

function readMetricNumber(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return null;

  for (const key of keys) {
    const value = (payload as JsonMap)[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function readMetricString(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return null;

  for (const key of keys) {
    const value = (payload as JsonMap)[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  return null;
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);

  const url = new URL(request.url);
  const teamNumber = normalizeTeamNumber(url.searchParams.get("team") ?? "");

  if (!teamNumber) {
    throw new Response("Missing team.", { status: 400 });
  }

  const [robotTeamProfile, vrcProfile] = await Promise.all([
    getRobotTeamByNumber(teamNumber).catch(() => null),
    getVrcTeamProfile(teamNumber).catch(() => null),
  ]);

  const wins = readMetricNumber(vrcProfile, ["wins", "win_count"]);
  const losses = readMetricNumber(vrcProfile, ["losses", "loss_count"]);
  const ties = readMetricNumber(vrcProfile, ["ties", "tie_count"]);
  const directWinRate = readMetricNumber(vrcProfile, ["win_rate", "winRate"]);
  const computedWinRate =
    wins !== null && losses !== null ? wins / Math.max(1, wins + losses + (ties ?? 0)) : null;

  return {
    teamNumber,
    teamName:
      readMetricString(vrcProfile, ["team_name", "teamName", "organization"]) ||
      robotTeamProfile?.team_name ||
      robotTeamProfile?.organization ||
      "Unknown team",
    opr: readMetricNumber(vrcProfile, ["opr", "OPR"]),
    trueskill: readMetricNumber(vrcProfile, ["trueskill", "trueSkill", "trueskill_mu", "mu", "ts"]),
    winRate: directWinRate ?? computedWinRate,
  };
}
