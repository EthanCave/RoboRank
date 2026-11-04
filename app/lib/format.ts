const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortDateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function parse(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined) {
  const date = parse(value);
  return date ? dateFormat.format(date) : "TBD";
}

export function formatShortDate(value: string | null | undefined) {
  const date = parse(value);
  return date ? shortDateFormat.format(date) : "TBD";
}

export function formatTime(value: string | null | undefined) {
  const date = parse(value);
  return date ? timeFormat.format(date) : "";
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  const a = parse(start);
  const b = parse(end);
  if (!a) return "TBD";
  if (!b || a.toDateString() === b.toDateString()) return dateFormat.format(a);
  if (a.getFullYear() === b.getFullYear()) return `${shortDateFormat.format(a)} – ${dateFormat.format(b)}`;
  return `${dateFormat.format(a)} – ${dateFormat.format(b)}`;
}

/** "today", "in 3 days", "2 weeks ago"… */
export function formatRelativeDay(value: string | null | undefined, now = new Date()) {
  const date = parse(value);
  if (!date) return "";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const abs = Math.abs(days);
  const unit = abs >= 14 ? `${Math.round(abs / 7)} weeks` : `${abs} days`;
  return days > 0 ? `in ${unit}` : `${unit} ago`;
}

export function formatPercent(value: number | null | undefined, decimals = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatMetric(value: number | null | undefined, decimals = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "–";
  return value.toFixed(decimals);
}

export function formatRecord(wins: number, losses: number, ties: number) {
  return `${wins}-${losses}-${ties}`;
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** RobotEvents names carry ™/® marks on every event; drop them for readability. */
export function cleanName(name: string | null | undefined) {
  return (name ?? "").replace(/[\u2122\u00ae]/g, "").replace(/\s{2,}/g, " ").trim();
}

export function formatLocation(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(", ") || "Location TBD";
}

/** True when an event's start–end range overlaps the given local calendar day. */
export function isEventOnDay(event: { start?: string | null; end?: string | null }, date = new Date()) {
  const start = Date.parse(event.start ?? "");
  const end = Date.parse(event.end ?? event.start ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return start <= dayStart + 86_400_000 - 1 && end >= dayStart;
}
