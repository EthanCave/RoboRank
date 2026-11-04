import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("set-team", "routes/set-team.tsx"),
  route("theme", "routes/theme.tsx"),
  route("search", "routes/search.tsx"),
  layout("routes/app-shell.tsx", [
    index("routes/home.tsx"),
    route("teams/:teamNumber", "routes/team.tsx"),
    route("events", "routes/events.tsx"),
    route("events/:eventId", "routes/event.tsx"),
    route("events/:eventId/simulate", "routes/simulate.tsx"),
    route("competition", "routes/competition.tsx"),
    route("rankings", "routes/rankings.tsx"),
  ]),
  // Old URLs from the previous layout.
  route("scouting", "routes/legacy-redirect.tsx", { id: "legacy-scouting" }),
  route("dashboard", "routes/legacy-redirect.tsx", { id: "legacy-dashboard" }),
  route("simulation", "routes/legacy-redirect.tsx", { id: "legacy-simulation" }),
  route("schedule", "routes/legacy-redirect.tsx", { id: "legacy-schedule" }),
] satisfies RouteConfig;
