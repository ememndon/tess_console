import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { BODY } from "../fonts";
import { useVmin, hexA, useDesign } from "../ui";
import type { Theme } from "../theme";

// GlobalResumeHub motif — a clean CV sheet that rises and straightens, its lines
// filling in, an ATS check stamping on, ringed by floating country chips + globe arcs.

const COUNTRIES = ["US", "UK", "DE", "NG", "CA", "AU", "FR", "IN"];

export const Ambient: React.FC<{ theme: Theme }> = ({ theme }) => {
  const { frame, fps } = useDesign();
  const u = useVmin();
  return (
    <AbsoluteFill>
      {/* faint globe longitude/latitude arcs */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 0.12 }}>
        <svg width={86 * u} height={86 * u} viewBox="0 0 100 100" style={{ transform: `rotate(${frame / 14}deg)` }}>
          <circle cx="50" cy="50" r="48" fill="none" stroke={theme.ink} strokeWidth="0.4" />
          <ellipse cx="50" cy="50" rx="20" ry="48" fill="none" stroke={theme.ink} strokeWidth="0.4" />
          <ellipse cx="50" cy="50" rx="38" ry="48" fill="none" stroke={theme.ink} strokeWidth="0.4" />
          <line x1="2" y1="50" x2="98" y2="50" stroke={theme.ink} strokeWidth="0.4" />
          <ellipse cx="50" cy="50" rx="48" ry="22" fill="none" stroke={theme.ink} strokeWidth="0.4" />
        </svg>
      </AbsoluteFill>
      {COUNTRIES.map((c, i) => {
        const ang = (i / COUNTRIES.length) * Math.PI * 2 + frame / 220;
        const rad = 40 * u;
        const cs = spring({ frame: frame - 10 - i * 2, fps, config: { damping: 14 } });
        return (
          <div key={c} style={{ position: "absolute", left: "50%", top: "44%", transform: `translate(-50%,-50%) translate(${Math.cos(ang) * rad}px, ${Math.sin(ang) * rad * 0.62}px) scale(${cs})`, padding: `${0.8 * u}px ${1.8 * u}px`, borderRadius: 99, background: hexA(theme.accent, 0.16), border: `${0.15 * u}px solid ${hexA(theme.accent, 0.6)}`, color: theme.accent, fontFamily: BODY, fontWeight: 700, fontSize: 2.1 * u, opacity: interpolate(cs, [0, 1], [0, 1], { extrapolateRight: "clamp" }) }}>
            {c}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const LINES = [
  { w: 58, accent: true }, { w: 86, accent: false }, { w: 78, accent: false },
  { w: 90, accent: false }, { w: 40, accent: true }, { w: 82, accent: false }, { w: 68, accent: false },
];

export const Card: React.FC<{ theme: Theme; delay: number }> = ({ theme, delay }) => {
  const { frame, fps } = useDesign();
  const u = useVmin();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 1.2 } });
  const rot = interpolate(s, [0, 1], [-5, 0]);
  const atsS = spring({ frame: frame - delay - 26, fps, config: { damping: 9, mass: 0.6 } });
  return (
    <div style={{ position: "relative", opacity: interpolate(s, [0, 1], [0, 1]), transform: `translateY(${interpolate(s, [0, 1], [6 * u, 0])}px) rotate(${rot}deg)`, width: 42 * u, padding: 3.4 * u, borderRadius: 3 * u, background: "#FFFFFF", boxShadow: `0 ${2.4 * u}px ${6 * u}px rgba(0,0,0,0.5)`, display: "flex", flexDirection: "column", gap: 2 * u }}>
      {/* header: avatar + name block */}
      <div style={{ display: "flex", alignItems: "center", gap: 2.2 * u, marginBottom: 0.6 * u }}>
        <div style={{ width: 8 * u, height: 8 * u, borderRadius: "50%", background: hexA(theme.bright, 0.25), border: `${0.3 * u}px solid ${hexA(theme.bright, 0.5)}` }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 1 * u }}>
          <div style={{ width: 20 * u, height: 2 * u, borderRadius: 99, background: "#1f2937" }} />
          <div style={{ width: 13 * u, height: 1.4 * u, borderRadius: 99, background: theme.accent }} />
        </div>
      </div>
      <div style={{ width: "100%", height: 0.3 * u, background: "#e5e7eb" }} />
      {LINES.map((ln, i) => {
        const ls = spring({ frame: frame - delay - 12 - i * 3, fps, config: { damping: 200 } });
        return <div key={i} style={{ height: 1.5 * u, borderRadius: 99, background: ln.accent ? theme.accent : "#d8dee9", width: `${ln.w * ls}%` }} />;
      })}
      {/* ATS stamp */}
      <div style={{ position: "absolute", top: -2.6 * u, right: -2.2 * u, transform: `scale(${atsS}) rotate(${interpolate(atsS, [0, 1], [-18, -8])}deg)`, opacity: interpolate(atsS, [0, 1], [0, 1], { extrapolateRight: "clamp" }), display: "flex", alignItems: "center", gap: 0.8 * u, padding: `${1 * u}px ${2 * u}px`, borderRadius: 99, background: "#16a34a", color: "#fff", fontFamily: BODY, fontWeight: 700, fontSize: 2.3 * u, boxShadow: `0 ${0.8 * u}px ${2 * u}px rgba(0,0,0,0.35)` }}>
        ✓ ATS-ready
      </div>
    </div>
  );
};
