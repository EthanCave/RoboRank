import { cx } from "./ui";

export type FormPoint = { margin: number; label: string };

/**
 * Recent form: one bar per match, oldest → newest. Wins rise above the center line, losses drop
 * below it, and bar length is the winning/losing margin. A W/L/T row and summary make it readable
 * without hovering.
 */
export function FormChart({ points }: { points: FormPoint[] }) {
  if (!points.length) return null;
  const maxMargin = Math.max(...points.map((p) => Math.abs(p.margin)), 1);
  const wins = points.filter((p) => p.margin > 0).length;
  const losses = points.filter((p) => p.margin < 0).length;
  const ties = points.length - wins - losses;
  const avg = points.reduce((sum, p) => sum + p.margin, 0) / points.length;
  const half = 44; // px for each side of the center line

  return (
    <figure>
      <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm">
          <span className="font-medium">
            {wins}W · {losses}L{ties ? ` · ${ties}T` : ""}
          </span>
          <span className="text-muted"> in the last {points.length}</span>
        </span>
        <span className="text-sm text-muted">
          Avg margin{" "}
          <span className={cx("font-mono", avg > 0 ? "text-accent-strong" : avg < 0 ? "text-red" : "text-ink")}>
            {avg > 0 ? "+" : ""}
            {avg.toFixed(0)}
          </span>
        </span>
      </figcaption>

      <div className="relative" role="img" aria-label={`Last ${points.length} matches: ${wins} wins, ${losses} losses, ${ties} ties`}>
        <div className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: half }} aria-hidden="true" />
        <div className="relative flex justify-between gap-1">
          {points.map((point, i) => {
            const size = Math.max(4, (Math.abs(point.margin) / maxMargin) * (half - 4));
            const tone = point.margin > 0 ? "bg-accent-strong" : point.margin < 0 ? "bg-red" : "bg-muted";
            const result = point.margin > 0 ? "W" : point.margin < 0 ? "L" : "T";
            return (
              <div key={i} className="flex min-w-0 max-w-8 flex-1 flex-col items-center" title={`${result} ${point.label}`}>
                <div className="flex w-full flex-col justify-end" style={{ height: half }}>
                  {point.margin >= 0 ? <span className={cx("block w-full rounded-t-md", tone)} style={{ height: point.margin === 0 ? 3 : size }} /> : null}
                </div>
                <div className="flex w-full flex-col justify-start" style={{ height: half }}>
                  {point.margin < 0 ? <span className={cx("block w-full rounded-b-md", tone)} style={{ height: size }} /> : null}
                </div>
                <span className={cx("mt-1.5 font-mono text-[10px]", point.margin > 0 ? "text-accent-strong" : point.margin < 0 ? "text-red" : "text-muted")}>
                  {result}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-muted">
        <span>← older</span>
        <span>bar = point margin · newest →</span>
      </div>
    </figure>
  );
}

/** Step chart of a rating over time (e.g. TrueSkill after each match). */
export function StepChart({ values, height = 140 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const width = 600;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (v: number) => height - 8 - ((v - min) / span) * (height - 24);
  const step = width / (values.length - 1);

  let path = `M0 ${y(values[0])}`;
  values.forEach((value, i) => {
    if (i === 0) return;
    path += ` H${(i * step).toFixed(1)} V${y(value).toFixed(1)}`;
  });
  const area = `${path} V${height} H0 Z`;
  const last = values[values.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full text-accent-strong" preserveAspectRatio="none" role="img" aria-label="Rating trend">
      <defs>
        <pattern id="step-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
        </pattern>
      </defs>
      <path d={area} fill="url(#step-hatch)" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      <circle cx={width} cy={y(last)} r="5" fill="currentColor" />
    </svg>
  );
}

/** Vertical hatched bars for comparing a handful of values (e.g. top skills scores). */
export function Bars({ items, highlight }: { items: Array<{ label: string; value: number }>; highlight?: string }) {
  if (!items.length) return null;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="flex h-44 items-end gap-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="font-mono text-xs text-ink-2">{Math.round(item.value)}</span>
          <div
            className={cx("hatch w-full rounded-t-xl", item.label === highlight ? "text-accent-strong" : "text-ink/70")}
            style={{ height: `${Math.max((item.value / max) * 120, 4)}px` }}
          />
          <span className="w-full truncate text-center font-mono text-[11px] text-muted">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
