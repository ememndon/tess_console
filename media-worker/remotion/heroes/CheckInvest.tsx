import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { BODY } from "../fonts";
import { useVmin, hexA, useDesign } from "../ui";
import type { Theme } from "../theme";

// CheckInvest motif — a growth panel: bars springing up, a trend line drawing in
// with an arrowhead, and a return % counting up, over floating ₦ marks.

export const Ambient: React.FC<{ theme: Theme }> = ({ theme }) => {
  const { frame } = useDesign();
  const u = useVmin();
  const marks = [
    { x: 14, y: 24, sz: 8, sp: 44 }, { x: 86, y: 30, sz: 6, sp: 52 },
    { x: 80, y: 76, sz: 9, sp: 48 }, { x: 18, y: 72, sz: 7, sp: 56 },
  ];
  return (
    <AbsoluteFill>
      {marks.map((m, i) => (
        <div key={i} style={{ position: "absolute", left: `${m.x}%`, top: `${m.y}%`, fontFamily: BODY, fontWeight: 700, fontSize: m.sz * u, color: i % 2 ? hexA(theme.accent, 0.16) : hexA("#FFFFFF", 0.08), transform: `translate(-50%,-50%) translateY(${Math.sin((frame + i * 26) / m.sp) * 1.5 * u}px)` }}>₦</div>
      ))}
    </AbsoluteFill>
  );
};

const BARS = [0.34, 0.5, 0.42, 0.66, 0.82, 1.0]; // relative heights (last = tallest)

export const Card: React.FC<{ theme: Theme; delay: number }> = ({ theme, delay }) => {
  const { frame, fps } = useDesign();
  const u = useVmin();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 1.1 } });
  const pct = interpolate(frame - delay, [10, 40], [0, 18.5], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const W = 50 * u, H = 40 * u, plotH = 24 * u, plotW = 42 * u;
  // trend line draw-in across the bar tops
  const lineProg = interpolate(frame - delay, [14, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pts = BARS.map((b, i) => ({ x: (i + 0.5) * (plotW / BARS.length), y: plotH - b * plotH }));
  const poly = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div style={{ opacity: interpolate(s, [0, 1], [0, 1]), transform: `translateY(${interpolate(s, [0, 1], [5 * u, 0])}px) scale(${interpolate(s, [0, 1], [0.88, 1])})`, width: W, height: H, padding: 3 * u, borderRadius: 3.5 * u, background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))", border: `${0.25 * u}px solid ${hexA("#FFFFFF", 0.14)}`, boxShadow: `0 ${2 * u}px ${5 * u}px rgba(0,0,0,0.45)`, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 1.4 * u }}>
        <span style={{ fontFamily: BODY, fontWeight: 700, fontSize: 5.4 * u, color: theme.accent }}>▲ {pct.toFixed(1)}%</span>
        <span style={{ fontFamily: BODY, fontWeight: 500, fontSize: 2.2 * u, color: hexA("#FFFFFF", 0.7) }}>projected return</span>
      </div>
      <div style={{ position: "relative", width: plotW, height: plotH, alignSelf: "center", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {BARS.map((b, i) => {
          const bs = spring({ frame: frame - delay - 6 - i * 2.4, fps, config: { damping: 16, mass: 0.7 } });
          return <div key={i} style={{ width: (plotW / BARS.length) * 0.52, height: b * plotH * bs, borderRadius: `${0.8 * u}px ${0.8 * u}px 0 0`, background: `linear-gradient(180deg, ${theme.accent}, ${theme.bright})` }} />;
        })}
        {/* trend line + arrowhead overlaid on the bar tops */}
        <svg width={plotW} height={plotH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <polyline points={poly} fill="none" stroke="#FFFFFF" strokeWidth={0.7 * u} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={plotW * 1.6} strokeDashoffset={plotW * 1.6 * (1 - lineProg)} />
          {lineProg > 0.96 && (
            <polygon points={`${last.x},${last.y - 1.6 * u} ${last.x - 1.4 * u},${last.y + 1 * u} ${last.x + 1.4 * u},${last.y + 1 * u}`} fill="#FFFFFF" />
          )}
        </svg>
      </div>
    </div>
  );
};
