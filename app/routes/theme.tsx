import { data, redirect } from "react-router";

import type { Route } from "./+types/theme";
import { themeCookie, type Theme } from "../lib/theme.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const value = String(form.get("theme") ?? "system");
  const theme: Theme = value === "light" || value === "dark" ? value : "system";
  return data({ theme }, { headers: { "Set-Cookie": themeCookie(theme) } });
}

export async function loader() {
  throw redirect("/");
}
