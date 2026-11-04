import { redirect } from "react-router";

import type { Route } from "./+types/schedule";

export function meta(_: Route.MetaArgs) {
  return [{ title: "RoboRank | Events" }];
}

export async function loader() {
  throw redirect("/events");
}

export default function ScheduleRedirectPage() {
  return null;
}
