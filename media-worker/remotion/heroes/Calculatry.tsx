import React from "react";
import { AbsoluteFill, interpolate, spring } from "remotion";
import { BODY } from "../fonts";
import { useVmin, hexA, useDesign } from "../ui";
import type { Theme } from "../theme";

// Calculatry motif — a glassy calculator: a display that counts up + a keypad whose
// keys spring in one-by-one, over drifting math-operator glyphs.

const GLYPHS = [
  { s: "+", x: 12, y: 20, sz: 9, sp: 41 }, { s: "×", x: 84, y: 16, sz: 11, sp: 53 },
  { s: "÷", x: 80, y: 74, sz: 8, sp: 47 }, { s: "−", x: 16, y: 78, sz: 10, sp: 59 },
  { s: "%", x: 50, y: 10, sz: 7, sp: 44 }, { s: "=", x: 90, y: 46, sz: 8, sp: 50 },
];

export const Ambient: React.FC<{ theme: Theme }> = ({ theme }) => {
  const { frame } = useDesign();
  const u = useVmin();
  return (
    <AbsoluteFill>
      {GLYPHS.map((g, i) => (
        <div key={i} style={{ position: "absolute", left: `${g.x}%`, top: `${g.y}%`, fontFamily: BODY, fontWeight: 700, fontSize: g.sz * u, color: i % 2 ? hexA(theme.accent, 0.16) : hexA("#FFFFFF", 0.1), transform: `translate(-50%,-50%) translateY(${Math.sin((frame + i * 22) / g.sp) * 1.4 * u}px) rotate(${Math.sin((frame + i * 30) / 70) * 8}deg)` }}>
          {g.s}
        </div>
      ))}
    </AbsoluteFill>
  );
};

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "%", "0", "="];

export const Card: React.FC<{ theme: Theme; delay: number }> = ({ theme, delay }) => {
  const { frame, fps } = useDesign();
  const u = useVmin();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200, mass: 1.1 } });
  const count = Math.round(interpolate(frame - delay, [6, 34], [0, 1728], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <div style={{ opacity: interpolate(s, [0, 1], [0, 1]), transform: `translateY(${interpolate(s, [0, 1], [5 * u, 0])}px) scale(${interpolate(s, [0, 1], [0.86, 1])})`, width: 45 * u, padding: 3 * u, borderRadius: 4.5 * u, background: "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))", border: `${0.25 * u}px solid ${hexA("#FFFFFF", 0.14)}`, boxShadow: `0 ${2 * u}px ${5 * u}px rgba(0,0,0,0.45)`, display: "flex", flexDirection: "column", gap: 2.2 * u }}>
      <div style={{ height: 9 * u, borderRadius: 2 * u, background: hexA("#000000", 0.32), display: "flex", alignItems: "center", justifyContent: "flex-end", padding: `0 ${2.4 * u}px`, fontFamily: BODY, fontWeight: 700, fontSize: 5 * u, color: theme.accent, letterSpacing: 0.3 * u }}>
        {count.toLocaleString()}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5 * u }}>
        {KEYS.map((k, i) => {
          const ks = spring({ frame: frame - delay - 8 - i * 1.1, fps, config: { damping: 14, mass: 0.6 } });
          const accentKey = k === "=";
          return (
            <div key={i} style={{ height: 6.4 * u, borderRadius: 1.6 * u, background: accentKey ? theme.accent : hexA("#FFFFFF", 0.08), border: `${0.15 * u}px solid ${hexA("#FFFFFF", accentKey ? 0 : 0.12)}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BODY, fontWeight: 600, fontSize: 3.1 * u, color: accentKey ? theme.base : "#FFFFFF", opacity: interpolate(ks, [0, 1], [0, 1], { extrapolateRight: "clamp" }), transform: `scale(${interpolate(ks, [0, 1], [0.4, 1])})` }}>
              {k}
            </div>
          );
        })}
      </div>
    </div>
  );
};
