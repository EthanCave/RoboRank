import { Form, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/login";
import { createSessionCookie, getDefaultTeamCode, getUserFromRequest, verifyLoginPassword } from "../lib/auth.server";
import { normalizeTeamNumber } from "../lib/teams";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in · RoboRank" }, { name: "description", content: "Scouting, ratings and match predictions for VEX V5 teams." }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserFromRequest(request)) throw redirect("/");
  return { defaultTeamCode: getDefaultTeamCode() };
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const teamCode = normalizeTeamNumber(String(form.get("teamCode") ?? ""));

  if (!verifyLoginPassword(password)) {
    return { error: "That password isn't right.", teamCode };
  }

  return redirect("/", { headers: { "Set-Cookie": createSessionCookie(teamCode || getDefaultTeamCode()) } });
}

export default function LoginPage({ loaderData, actionData }: Route.ComponentProps) {
  const submitting = useNavigation().state === "submitting";

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-center gap-6 px-4 py-10 lg:grid-cols-2">
      <section className="relative overflow-hidden rounded-[32px] bg-hero p-8 text-hero-ink sm:p-10">
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-accent opacity-30 blur-3xl" aria-hidden="true" />
        <p className="text-sm text-white/60">roborank</p>
        <h1 className="display mt-6 text-6xl sm:text-7xl">
          Scout smarter.
          <br />
          <span className="text-accent">Pick better.</span>
        </h1>
        <ul className="relative mt-10 grid gap-3 text-white/75">
          <li>TrueSkill and OPR for every V5RC team this season</li>
          <li>Win odds for every match, live on competition day</li>
          <li>Event simulations and shared scouting notes</li>
        </ul>
      </section>

      <section className="card p-8 sm:p-10">
        <h2 className="text-3xl font-medium tracking-tight">Team sign in</h2>
        <p className="mt-2 text-muted">One shared password for your whole team.</p>

        <Form method="post" className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Team number</span>
            <input type="text" name="teamCode" defaultValue={actionData?.teamCode ?? loaderData.defaultTeamCode} className="field font-mono uppercase" autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Password</span>
            <input type="password" name="password" className="field" required autoComplete="current-password" />
          </label>
          {actionData?.error ? (
            <p className="text-sm text-red" role="alert">
              {actionData.error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary mt-2 py-3" disabled={submitting}>
            {submitting ? "Signing in…" : "Enter RoboRank"}
          </button>
        </Form>
      </section>
    </main>
  );
}
