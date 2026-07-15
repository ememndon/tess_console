import React, { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CameraMotionBlur } from "@remotion/motion-blur";
import { THEME, type Site } from "./theme";
import { fontsReady } from "./fonts";
import { Backdrop, Wordmark, Underline, Tagline, Domain, CtaPill, useVmin } from "./ui";
import { SoundLayer } from "./sound";
import { ConfettiBurst } from "./lottie-fx";
import * as Calculatry from "./heroes/Calculatry";
import * as ResumeHub from "./heroes/ResumeHub";
import * as CheckInvest from "./heroes/CheckInvest";

const HEROES: Record<Site, { Ambient: React.FC<{ theme: typeof THEME[Site] }>; Card: React.FC<{ theme: typeof THEME[Site]; delay: number }> }> = {
  calculatry: Calculatry,
  resumehub: ResumeHub,
  checkinvest: CheckInvest,
};

export type SlideProps = {
  site: Site;
  kind: "intro" | "outro";
  logo?: string | null;
  tagline?: string;
};

export const BrandSlide: React.FC<SlideProps> = ({ site, kind, logo, tagline }) => {
  const theme = THEME[site];
  const Hero = HEROES[site];
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const u = useVmin();

  // Wait for fonts so nothing renders in a fallback face.
  const [handle] = useState(() => delayRender("load-fonts"));
  useEffect(() => {
    fontsReady.then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);

  // Cinematic in/out fade across the whole slide (real-frame timing).
  const fade = interpolate(frame, [0, 8, durationInFrames - 12, durationInFrames - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tag = tagline || theme.tagline;

  const body = (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", padding: `0 ${8 * u}px` }}>
      {kind === "intro" ? (
        <>
          <div style={{ marginBottom: 4.4 * u, display: "flex", justifyContent: "center" }}>
            <Hero.Card theme={theme} delay={4} />
          </div>
          <Wordmark theme={theme} logo={logo} delay={16} />
          <Underline theme={theme} delay={24} />
          <Tagline theme={theme} text={tag} delay={30} />
          <Domain theme={theme} delay={36} />
        </>
      ) : (
        <>
          <Wordmark theme={theme} logo={logo} delay={6} size={7.6} />
          <Underline theme={theme} delay={14} />
          <CtaPill theme={theme} delay={22} />
          <div style={{ height: 2.6 * u }} />
          <Domain theme={theme} delay={30} />
        </>
      )}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Backdrop theme={theme} />
      <Hero.Ambient theme={theme} />
      {/* Motion-blur ONLY the intro (snappy hero motion). The outro is a long, gentle
          ~11s hold — blurring 660 frames would blow the render budget (and it falls back
          to the basic ffmpeg slide on timeout). */}
      {kind === "intro" ? <CameraMotionBlur shutterAngle={160} samples={3}>{body}</CameraMotionBlur> : body}
      {/* Lottie confetti flourish at the brand-lock beat (in front of the lockup). */}
      <ConfettiBurst atDesignFrame={kind === "intro" ? 24 : 26} />
      <SoundLayer site={site} kind={kind} />
    </AbsoluteFill>
  );
};
