import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Lottie, type LottieAnimationData } from "@remotion/lottie";
import confetti from "./lottie/confetti.json";

// A self-authored (license-clean) confetti burst played via @remotion/lottie — robust
// 2D vector motion, no WebGL. Drop any licensed LottieFiles JSON into remotion/lottie/
// and import it here to swap. `atDesignFrame` is on the virtual-30fps timeline.
export const ConfettiBurst: React.FC<{ atDesignFrame: number }> = ({ atDesignFrame }) => {
  const { fps, width, height } = useVideoConfig();
  const from = Math.round((atDesignFrame * fps) / 30);
  const dur = Math.round(1.3 * fps);
  const sq = Math.min(width, height) * 1.15;
  return (
    <Sequence from={from} durationInFrames={dur} layout="none">
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: sq, height: sq }}>
          <Lottie animationData={confetti as unknown as LottieAnimationData} loop={false} style={{ width: "100%", height: "100%" }} />
        </div>
      </AbsoluteFill>
    </Sequence>
  );
};
