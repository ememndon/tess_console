import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { Site } from "./theme";

// SFX timing is in wall-clock (real) frames; the visual timeline is virtual-30fps, so
// convert design-frames → real-frames with the actual fps.
const useAt = () => {
  const { fps } = useVideoConfig();
  return (designFrame30: number) => Math.round((designFrame30 * fps) / 30);
};

const Sfx: React.FC<{ src: string; at: number; volume?: number }> = ({ src, at, volume = 1 }) => (
  <Sequence from={Math.max(0, at)} layout="none">
    <Audio src={staticFile(src)} volume={volume} />
  </Sequence>
);

// Subtle, tasteful sound design synced to the on-screen motion (mixed UNDER the
// voiceover in the render). whoosh = reveal, tick = UI elements landing, chime = lock.
export const SoundLayer: React.FC<{ site: Site; kind: "intro" | "outro" }> = ({ kind }) => {
  const at = useAt();
  if (kind === "outro") {
    return (
      <>
        <Sfx src="sfx/whoosh.mp3" at={at(4)} volume={0.5} />
        <Sfx src="sfx/chime.mp3" at={at(22)} volume={0.5} />
      </>
    );
  }
  return (
    <>
      <Sfx src="sfx/whoosh.mp3" at={at(2)} volume={0.55} />
      {[8, 11, 14, 17, 20].map((f, i) => (
        <Sfx key={i} src="sfx/tick.mp3" at={at(f)} volume={0.3} />
      ))}
      <Sfx src="sfx/chime.mp3" at={at(20)} volume={0.5} />
    </>
  );
};
