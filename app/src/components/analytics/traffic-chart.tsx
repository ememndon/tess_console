"use client";

import { useState } from "react";
import type { TimePoint } from "@/lib/analytics";

// Dependency-free SVG chart: pageviews as a filled area, unique visitors as a
// line, Google algorithm-update annotations overlaid. Themed through
// Tailwind/CSS-variable utility classes. Hovering shows a vertical pointer line,
// markers on each series, and a tooltip with that point's values.

const W = 960;
const H = 260;
const PAD = { t: 16, r: 16, b: 28, l: 40 };

function fmtLabel(t: string, hourly: boolean): string {
  if (hourly) return t.slice(11, 16); // HH:00
  const d = new Date(t + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function TrafficChart({
  points,
  hourly,
  annotations = [],
  aLabel = "pageviews",
  bLabel = "visitors",
}: {
  points: TimePoint[];
  hourly: boolean;
  annotations?: { date: string; label: string }[];
  aLabel?: string;
  bLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(1, ...points.map((p) => p.pageviews));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;

  const x = (i: number) => PAD.l + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - (v / niceMax) * innerH;

  const areaPath =
    points.length > 0
      ? `M ${x(0)} ${y(points[0].pageviews)} ` +
        points.map((p, i) => `L ${x(i)} ${y(p.pageviews)}`).join(" ") +
        ` L ${x(points.length - 1)} ${PAD.t + innerH} L ${x(0)} ${PAD.t + innerH} Z`
      : "";
  const pvLine = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.pageviews)}`).join(" ");
  const visLine = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.visitors)}`).join(" ");

  // X-axis labels: show ~7 evenly spaced ticks.
  const tickStep = Math.max(1, Math.ceil(points.length / 7));

  // Map annotation dates onto bucket indices (daily ranges only).
  const annoMarks = hourly
    ? []
    : annotations
        .map((a) => ({ ...a, i: points.findIndex((p) => p.t === a.date) }))
        .filter((a) => a.i >= 0);

  // Tooltip geometry for the hovered point.
  const hp = hover != null ? points[hover] : null;
  const TW = 132;
  const TH = 58;
  const tx = hover != null ? Math.min(Math.max(x(hover) + 10, PAD.l), W - PAD.r - TW) : 0;
  const ty = PAD.t + 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label="Traffic over time">
      <defs>
        <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.38 }} />
          <stop offset="100%" style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {/* Horizontal gridlines + y labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const gy = PAD.t + innerH - f * innerH;
        return (
          <g key={f}>
            <line x1={PAD.l} y1={gy} x2={W - PAD.r} y2={gy} className="stroke-border" strokeWidth={1} />
            <text x={PAD.l - 6} y={gy + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {Math.round(niceMax * f)}
            </text>
          </g>
        );
      })}

      {/* Algorithm-update annotations */}
      {annoMarks.map((a) => (
        <g key={a.date}>
          <line
            x1={x(a.i)}
            y1={PAD.t}
            x2={x(a.i)}
            y2={PAD.t + innerH}
            className="stroke-amber-500/60"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text x={x(a.i) + 3} y={PAD.t + 8} className="fill-amber-600 text-[9px] dark:fill-amber-400">
            {a.label}
          </text>
        </g>
      ))}

      {/* Pageviews area + line */}
      {areaPath && <path d={areaPath} fill="url(#pvFill)" />}
      {points.length > 1 && <path d={pvLine} fill="none" className="stroke-chart-1" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
      {/* Visitors line */}
      {points.length > 1 && (
        <path d={visLine} fill="none" className="stroke-chart-2" strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" />
      )}

      {/* X labels */}
      {points.map((p, i) =>
        i % tickStep === 0 || i === points.length - 1 ? (
          <text
            key={i}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {fmtLabel(p.t, hourly)}
          </text>
        ) : null,
      )}

      {/* Hover crosshair + markers + tooltip (drawn under the hit targets) */}
      {hp && (
        <g pointerEvents="none">
          <line x1={x(hover!)} y1={PAD.t} x2={x(hover!)} y2={PAD.t + innerH} className="stroke-foreground/40" strokeWidth={1} />
          <circle cx={x(hover!)} cy={y(hp.pageviews)} r={3.5} className="fill-chart-1 stroke-background" strokeWidth={1.5} />
          <circle cx={x(hover!)} cy={y(hp.visitors)} r={3.5} className="fill-chart-2 stroke-background" strokeWidth={1.5} />
          <g transform={`translate(${tx} ${ty})`}>
            <rect width={TW} height={TH} rx={6} className="fill-popover stroke-border" strokeWidth={1} opacity={0.97} />
            <text x={8} y={16} className="fill-foreground text-[10px] font-medium">{fmtLabel(hp.t, hourly)}</text>
            <circle cx={12} cy={30} r={3} className="fill-chart-1" />
            <text x={20} y={33} className="fill-muted-foreground text-[10px]">{hp.pageviews} {aLabel}</text>
            <circle cx={12} cy={46} r={3} className="fill-chart-2" />
            <text x={20} y={49} className="fill-muted-foreground text-[10px]">{hp.visitors} {bLabel}</text>
          </g>
        </g>
      )}

      {/* Hover targets — capture pointer per bucket and clear on leave. */}
      <g onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <rect
            key={`h${i}`}
            x={x(i) - (points.length > 1 ? innerW / (points.length - 1) / 2 : innerW / 2)}
            y={PAD.t}
            width={points.length > 1 ? innerW / (points.length - 1) : innerW}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseMove={() => setHover(i)}
          />
        ))}
      </g>
    </svg>
  );
}
