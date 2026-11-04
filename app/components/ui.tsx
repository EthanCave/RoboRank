import type { ReactNode } from "react";
import { Link } from "react-router";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 pb-6 pt-2 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="display text-5xl sm:text-6xl md:text-7xl break-words">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("card min-w-0", className)}>
      {title || action ? (
        <div className="mb-5 flex items-center justify-between gap-3">
          {title ? <h2 className="text-xl font-medium tracking-tight sm:text-2xl">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Round "↗" link button used in card corners. */
export function CornerLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="icon-btn" aria-label={label} title={label}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M5 11 11 5M6 5h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export function Stat({
  label,
  value,
  sub,
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  const sizes = { md: "text-3xl sm:text-4xl", lg: "text-5xl sm:text-6xl", xl: "text-6xl sm:text-7xl" };
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className={cx("display mt-2 tabular-nums", sizes[size])}>{value}</p>
      {sub ? <p className="mt-2 text-sm text-muted">{sub}</p> : null}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "red" | "blue" | "warn"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    accent: "bg-accent text-accent-ink",
    red: "bg-red-soft text-red",
    blue: "bg-blue-soft text-blue",
    warn: "bg-warn/20 text-warn",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <p className={cx("rounded-2xl px-4 py-3 text-sm", tone === "warn" ? "bg-warn/15 text-ink" : "bg-surface-2 text-ink-2")}>{children}</p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** Horizontal hatched bar (0–1). */
export function HatchBar({ value, tone = "accent", label }: { value: number; tone?: "accent" | "red" | "blue" | "ink"; label?: string }) {
  const colors = { accent: "text-accent-strong", red: "text-red", blue: "text-blue", ink: "text-ink" };
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)} aria-label={label}>
      <div className={cx("hatch h-full rounded-full", colors[tone])} style={{ width: `${Math.max(clamped * 100, 3)}%` }} />
    </div>
  );
}

/**
 * Match result from one team's point of view: "W 62–0". Color means result only
 * (lime win, red loss, gray tie) so it never competes with red/blue alliance colors.
 */
export function ResultPill({ ours, theirs }: { ours: number; theirs: number }) {
  const result = ours > theirs ? "W" : ours < theirs ? "L" : "T";
  const tone = result === "W" ? "bg-accent text-accent-ink" : result === "L" ? "bg-red-soft text-red" : "bg-surface-2 text-ink-2";
  return (
    <span className={cx("inline-flex min-w-24 items-center gap-2 rounded-full px-3 py-1 font-mono text-sm tabular-nums", tone)}>
      <span className="font-semibold">{result}</span>
      <span>
        {ours}–{theirs}
      </span>
    </span>
  );
}

/** Split bar showing red vs blue win probability. */
export function WinProbBar({ red }: { red: number }) {
  const redPct = Math.round(red * 100);
  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      <span className="w-9 text-right text-red">{redPct}%</span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-red" style={{ width: `${redPct}%` }} />
        <div className="h-full flex-1 bg-blue" />
      </div>
      <span className="w-9 text-blue">{100 - redPct}%</span>
    </div>
  );
}

export function Segmented({ items }: { items: Array<{ to: string; label: string; active: boolean }> }) {
  return (
    <nav className="scroll-x inline-flex max-w-full gap-1 rounded-full border border-line bg-surface p-1">
      {items.map((item) => (
        <Link key={item.to} to={item.to} className={cx("pill py-2", item.active ? "pill-active" : "pill-ghost")} preventScrollReset>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
