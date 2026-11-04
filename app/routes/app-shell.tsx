import { useEffect, useRef, useState } from "react";
import { Form, Link, NavLink, Outlet, useFetcher, useLocation, useNavigate, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/app-shell";
import { cx } from "../components/ui";
import { cleanName } from "../lib/format";
import { requireUser } from "../lib/auth.server";
import { getTeamContext } from "../lib/my-team.server";
import { getRobotEventsConfigurationError } from "../lib/robotevents.server";
import { ensureSeasonSync, getSyncStatus } from "../lib/season-sync.server";
import { countRatedTeams } from "../lib/stats.server";
import type { SearchResults } from "./search";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  ensureSeasonSync();
  const context = await getTeamContext(user.teamCode);

  return {
    user,
    configError: getRobotEventsConfigurationError(),
    competitionToday: context.today ? { id: context.today.id, name: context.today.name, sku: context.today.sku } : null,
    sync: getSyncStatus(),
    ratedTeams: countRatedTeams(),
  };
}

export function useShellData() {
  return useRouteLoaderData<typeof loader>("routes/app-shell");
}

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/events", label: "Events" },
  { to: "/rankings", label: "Rankings" },
  { to: "/competition", label: "Competition" },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="RoboRank home">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-accent">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 16V4h5.5a3.75 3.75 0 0 1 0 7.5H8m2.5 0L15 16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-xl font-semibold tracking-tight">roborank</span>
    </Link>
  );
}

function SearchBox() {
  const fetcher = useFetcher<SearchResults>();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [location.pathname]);

  function onChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value.trim().length >= 2) fetcher.load(`/search?q=${encodeURIComponent(value.trim())}`);
    }, 180);
  }

  const results = fetcher.data && fetcher.data.query === query.trim() ? fetcher.data : null;
  const showPanel = open && query.trim().length >= 2;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (results?.teams[0]) navigate(`/teams/${encodeURIComponent(results.teams[0])}`);
    else if (results?.events[0]) navigate(`/events/${results.events[0].id}`);
    else if (/^\d+[a-z]?$/i.test(query.trim())) navigate(`/teams/${encodeURIComponent(query.trim().toUpperCase())}`);
  }

  return (
    <div className="relative w-full md:w-72" onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}>
      <form onSubmit={onSubmit} role="search">
        <label className="sr-only" htmlFor="global-search">
          Search teams and events
        </label>
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-none text-muted">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
            <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            id="global-search"
            value={query}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Team number or event"
            autoComplete="off"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </div>
      </form>

      {showPanel ? (
        <div className="absolute right-0 z-30 mt-2 w-full rounded-3xl border border-line bg-surface p-2 shadow-xl md:w-96">
          {!results ? (
            <p className="px-3 py-3 text-sm text-muted">Searching…</p>
          ) : !results.teams.length && !results.events.length ? (
            <p className="px-3 py-3 text-sm text-muted">No matches for “{query}”.</p>
          ) : (
            <>
              {results.teams.length ? (
                <div className="p-1">
                  <p className="eyebrow px-2 pb-1.5">Teams</p>
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {results.teams.map((team) => (
                      <Link key={team} to={`/teams/${encodeURIComponent(team)}`} className="chip hover:bg-accent hover:text-accent-ink">
                        {team}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
              {results.events.length ? (
                <div className="mt-1 p-1">
                  <p className="eyebrow px-2 pb-1">Events</p>
                  {results.events.map((event) => (
                    <Link key={event.id} to={`/events/${event.id}`} className="block rounded-2xl px-2 py-2 hover:bg-surface-2">
                      <span className="line-clamp-1 text-sm font-medium">{cleanName(event.name)}</span>
                      <span className="font-mono text-xs text-muted">
                        {event.sku}
                        {event.region ? ` · ${event.region}` : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ThemeToggle() {
  const root = useRouteLoaderData("root") as { theme: "light" | "dark" | "system" } | undefined;
  const fetcher = useFetcher();
  const current = ((fetcher.formData?.get("theme") as string | null) ?? root?.theme ?? "system") as "light" | "dark" | "system";
  const next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
  const label = { system: "Theme: auto", dark: "Theme: dark", light: "Theme: light" }[current];

  return (
    <fetcher.Form method="post" action="/theme">
      <input type="hidden" name="theme" value={next} />
      <button type="submit" className="icon-btn" aria-label={`${label}. Switch theme.`} title={label}>
        {current === "dark" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M15 11.5A6.5 6.5 0 0 1 6.5 3 6.5 6.5 0 1 0 15 11.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        ) : current === "light" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.6" />
            <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M9 2.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
          </svg>
        )}
      </button>
    </fetcher.Form>
  );
}

function TeamSwitcher({ teamCode }: { teamCode: string }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname, location.search]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="grid h-9 min-w-9 place-items-center rounded-full bg-accent px-2 font-mono text-xs font-semibold text-accent-ink">{teamCode}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="text-muted">
          <path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Switch team or log out</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-3xl border border-line bg-surface p-4 shadow-xl" role="dialog" aria-label="Team settings">
          <Form method="post" action="/set-team" className="flex flex-col gap-3">
            <input type="hidden" name="redirectTo" value={`${location.pathname}${location.search}`} />
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="eyebrow">Team for this session</span>
              <input name="teamCode" defaultValue={teamCode} className="field font-mono uppercase" aria-label="Team number" />
            </label>
            <button type="submit" className="btn btn-primary">
              Switch team
            </button>
          </Form>
          <Form method="post" action="/logout" className="mt-3 border-t border-line pt-3">
            <button type="submit" className="btn btn-quiet w-full">
              Log out
            </button>
          </Form>
        </div>
      ) : null}
    </div>
  );
}

function SyncBanner() {
  const data = useShellData();
  if (!data) return null;
  if (data.configError) {
    return (
      <p className="mb-6 rounded-2xl bg-warn/15 px-4 py-3 text-sm">
        Set <code className="font-mono">ROBOTEVENTS_API_TOKEN</code> to load events, matches and ratings.
      </p>
    );
  }
  const { sync } = data;
  if (sync.state === "syncing" && (data.ratedTeams < 500 || sync.queued > 25)) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
        <span className="relative flex h-2.5 w-2.5 flex-none">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-strong opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-strong" />
        </span>
        <span>
          Building this season's ratings from RobotEvents
          {sync.queued ? ` — ${sync.processed} of ${sync.queued} events` : "…"}. Numbers fill in as it goes.
        </span>
      </div>
    );
  }
  if (sync.state === "error") {
    return <p className="mb-6 rounded-2xl bg-warn/15 px-4 py-3 text-sm">Season sync paused ({sync.message}). It retries automatically.</p>;
  }
  return null;
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { user, competitionToday } = loaderData;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-16 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center gap-3 py-5 lg:flex-nowrap lg:gap-4">
        <Logo />

        <nav aria-label="Primary" className="scroll-x order-3 -mx-4 flex w-[calc(100%+2rem)] gap-1 px-4 lg:order-none lg:mx-auto lg:w-auto lg:px-0">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx("pill", isActive ? "pill-active" : "pill-ghost")}>
              {item.label}
              {item.to === "/competition" && competitionToday ? (
                <span className="h-2 w-2 rounded-full bg-accent-strong" role="img" aria-label="Competing today" />
              ) : null}
            </NavLink>
          ))}
          <NavLink to={`/teams/${encodeURIComponent(user.teamCode)}`} className={({ isActive }) => cx("pill", isActive ? "pill-active" : "pill-ghost")}>
            Team {user.teamCode}
          </NavLink>
        </nav>

        <div className="order-4 w-full lg:order-none lg:w-auto">
          <SearchBox />
        </div>

        <div className="order-2 ml-auto flex items-center gap-2 lg:order-none lg:ml-0">
          <ThemeToggle />
          <TeamSwitcher teamCode={user.teamCode} />
        </div>
      </header>

      <SyncBanner />

      <main>
        <Outlet />
      </main>

      <footer className="mt-16 flex flex-wrap justify-between gap-2 border-t border-line pt-6 text-xs text-muted">
        <span>Data from RobotEvents · ratings computed by RoboRank</span>
        <span>TrueSkill shown as μ − 3σ, recomputed after every sync</span>
      </footer>
    </div>
  );
}
