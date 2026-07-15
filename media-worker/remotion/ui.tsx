import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { DISPLAY, BODY } from "./fonts";
import type { Theme } from "./theme";

// 1 "vmin" in px (min dimension / 100) — the output sizes all have a 1080 min side,
// so type stays consistent across 9:16 / 1:1 / 16:9.
export const useVmin = () => {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 100;
};

// All motion is authored on a virtual 30fps timeline so the real render fps (e.g. 60
// for buttery motion) only adds in-between frames — it never speeds the animation up.
// Components use this `frame`/`fps` for springs + interpolation instead of the raw ones.
const VFPS = 30;
export const useDesign = () => {
  const realFrame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { frame: (realFrame * VFPS) / fps, fps: VFPS };
};

const hexA = (hex: string, a: number) => {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
};

// Spring-driven rise+fade entrance.
export const useRise = (delay: number, dist = 36, damping = 200) => {
  const { frame, fps } = useDesign();
  const s = spring({ frame: frame - delay, fps, config: { damping, mass: 0.9 } });
  return { opacity: interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" }), transform: `translateY(${interpolate(s, [0, 1], [dist, 0])}px)` };
};

export const Backdrop: React.FC<{ theme: Theme }> = ({ theme }) => {
  const { frame } = useDesign();
  const drift = Math.sin(frame / 38) * 2.4;
  const drift2 = Math.cos(frame / 46) * 2.0;
  const u = useVmin();
  return (
    <AbsoluteFill style={{ backgroundColor: theme.base, background: `radial-gradient(80% 65% at 50% 42%, ${theme.bright} 0%, ${theme.mid} 48%, ${theme.base} 100%)` }}>
      <div style={{ position: "absolute", top: `${8 + drift}%`, left: "50%", width: 60 * u, height: 60 * u, transform: "translateX(-50%)", borderRadius: "50%", background: theme.accent, opacity: 0.16, filter: `blur(${7 * u}px)` }} />
      <div style={{ position: "absolute", top: `${46 + drift2}%`, left: "50%", width: 70 * u, height: 70 * u, transform: "translate(-50%,-50%)", borderRadius: "50%", background: theme.glow, opacity: 0.4, filter: `blur(${7 * u}px)` }} />
      {/* subtle top + bottom vignette for depth */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${hexA(theme.base, 0.35)} 0%, ${hexA(theme.base, 0)} 22%, ${hexA(theme.base, 0)} 72%, ${hexA(theme.base, 0.55)} 100%)` }} />
    </AbsoluteFill>
  );
};

// Brand lockup: optional real logo mark + heavy wordmark with accent suffix.
export const Wordmark: React.FC<{ theme: Theme; logo?: string | null; delay: number; size?: number }> = ({ theme, logo, delay, size = 7 }) => {
  const u = useVmin();
  const r = useRise(delay, 4 * u);
  return (
    <div style={{ ...r, display: "flex", alignItems: "center", gap: 2.2 * u, justifyContent: "center" }}>
      {logo ? <Img src={logo} style={{ height: size * 1.15 * u, width: size * 1.15 * u, objectFit: "contain", filter: "drop-shadow(0 0.6vmin 1.4vmin rgba(0,0,0,.45))" }} /> : null}
      <div style={{ fontFamily: DISPLAY, fontSize: size * u, lineHeight: 1, letterSpacing: -0.35 * u, color: theme.ink, textShadow: `0 ${0.4 * u}px ${2.4 * u}px rgba(0,0,0,.35)`, whiteSpace: "nowrap" }}>
        {theme.wordmark[0]}<span style={{ color: theme.accent }}>{theme.wordmark[1]}</span>
      </div>
    </div>
  );
};

export const Underline: React.FC<{ theme: Theme; delay: number; width?: number }> = ({ theme, delay, width = 13 }) => {
  const { frame, fps } = useDesign();
  const u = useVmin();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ marginTop: 2.4 * u, width: width * u, height: 1 * u, borderRadius: 99, background: theme.accent, transform: `scaleX(${s})`, boxShadow: `0 0 ${2.4 * u}px ${theme.accent}` }} />;
};

export const Tagline: React.FC<{ theme: Theme; text: string; delay: number }> = ({ theme, text, delay }) => {
  const u = useVmin();
  const r = useRise(delay, 2.4 * u);
  return <div style={{ ...r, marginTop: 3 * u, fontFamily: BODY, fontWeight: 500, fontSize: 3.2 * u, color: hexA(theme.ink, 0.92), maxWidth: 86 * u, textAlign: "center" }}>{text}</div>;
};

export const Domain: React.FC<{ theme: Theme; delay: number }> = ({ theme, delay }) => {
  const u = useVmin();
  const r = useRise(delay, 1.6 * u);
  // The site URL is the whole point of the ad — keep it clearly legible.
  return <div style={{ ...r, marginTop: 3.2 * u, fontFamily: BODY, fontWeight: 700, fontSize: 3.2 * u, letterSpacing: 0.15 * u, color: theme.urlColor ?? theme.accent }}>{theme.domain}</div>;
};

export const CtaPill: React.FC<{ theme: Theme; delay: number; label?: string }> = ({ theme, delay, label = "Try it free" }) => {
  const { frame, fps } = useDesign();
  const u = useVmin();
  const s = spring({ frame: frame - delay, fps, config: { damping: 12, mass: 0.7 } });
  return (
    <div style={{ marginTop: 4.4 * u, opacity: interpolate(s, [0, 1], [0, 1], { extrapolateRight: "clamp" }), transform: `scale(${interpolate(s, [0, 1], [0.85, 1])})`, fontFamily: BODY, fontWeight: 700, fontSize: 3.5 * u, color: "#fff", padding: `${1.7 * u}px ${4.8 * u}px`, borderRadius: 999, background: `linear-gradient(90deg, ${theme.bright}, ${theme.accent})`, boxShadow: `0 ${1.2 * u}px ${3.2 * u}px ${hexA(theme.accent, 0.4)}` }}>
      {label}
    </div>
  );
};

export { hexA };
