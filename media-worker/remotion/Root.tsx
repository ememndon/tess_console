import React from "react";
import { Composition } from "remotion";
import { BrandSlide } from "./BrandSlide";

// Single parametric composition. Dimensions, fps and duration come from the render's
// inputProps (per format + voiceover length) via calculateMetadata.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="BrandSlide"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component={BrandSlide as any}
      durationInFrames={90}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{ site: "calculatry", kind: "intro", logo: null, tagline: "" }}
      calculateMetadata={({ props }) => {
        const p = props as Record<string, number | undefined>;
        return {
          durationInFrames: Number(p.durationInFrames ?? 90),
          fps: Number(p.fps ?? 30),
          width: Number(p.width ?? 1080),
          height: Number(p.height ?? 1080),
          props,
        };
      }}
    />
  );
};
