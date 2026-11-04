export type Theme = "light" | "dark" | "system";

const COOKIE = "roborank_theme";

export function readTheme(request: Request): Theme {
  const match = request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(light|dark|system)`));
  return (match?.[1] as Theme | undefined) ?? "system";
}

export function themeCookie(theme: Theme) {
  return `${COOKIE}=${theme}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
}
