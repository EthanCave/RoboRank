import { redirect } from "react-router";

import type { Route } from "./+types/set-team";
import { createSessionCookie, requireUser } from "../lib/auth.server";
import { normalizeTeamNumber } from "../lib/teams";

/** Only same-site paths ("/x", not "//evil.com" or "https://…"). */
function safeRedirectPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

export async function action({ request }: Route.ActionArgs) {
  await requireUser(request);

  const formData = await request.formData();
  const teamCode = normalizeTeamNumber(String(formData.get("teamCode") ?? ""));

  return redirect(safeRedirectPath(formData.get("redirectTo")), {
    headers: {
      "Set-Cookie": createSessionCookie(teamCode),
    },
  });
}

export async function loader() {
  throw redirect("/");
}
