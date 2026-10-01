import type { RenderQuality } from "./render-quality";

/** Explicit user-selected rendering budget, independent of motion preferences. */
export const superPerformanceQuality: RenderQuality = {
  scale: 60,
  pixelRatio: 1,
  antialias: "off",
  shadows: 0,
  aoSamples: 0,
  aoResolution: 0.5,
  depthOfField: 0,
  transmission: 0.25,
  anisotropy: 2,
};
