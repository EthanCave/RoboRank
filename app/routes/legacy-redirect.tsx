import { redirect } from "react-router";

import type { Route } from "./+types/legacy-redirect";

export async function loader({ url }: Route.LoaderArgs) {
  const team = url.searchParams.get("team");
  const eventId = url.searchParams.get("eventId");

  switch (url.pathname.replace(/\/$/, "")) {
    case "/scouting":
      throw redirect(team ? `/teams/${encodeURIComponent(team)}` : "/");
    case "/dashboard":
      throw redirect(eventId ? `/events/${eventId}` : "/events");
    case "/simulation":
      throw redirect(eventId ? `/events/${eventId}/simulate` : "/events");
    default:
      throw redirect("/events");
  }
}
