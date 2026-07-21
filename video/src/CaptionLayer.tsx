import type { Caption } from "@remotion/captions";
import { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";

export const CaptionLayer: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender("Loading captions"));

  useEffect(() => {
    void fetch(staticFile("captions.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load captions: ${response.status}`);
        return response.json() as Promise<Caption[]>;
      })
      .then((parsed) => {
        setCaptions(parsed);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [cancelRender, continueRender, handle]);

  if (!captions) {
    return null;
  }

  const timeMs = (frame / fps) * 1000;
  const active = captions.find(
    (caption) => caption.startMs <= timeMs && caption.endMs > timeMs,
  );

  if (!active) {
    return null;
  }

  const activeFrame = frame - (active.startMs / 1000) * fps;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 112,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: 1480,
          padding: "18px 34px 20px",
          borderRadius: 18,
          color: "#f8fbff",
          backgroundColor: "rgba(7, 35, 61, 0.92)",
          boxShadow: "0 18px 44px rgba(7, 35, 61, 0.24)",
          fontSize: 40,
          fontWeight: 650,
          lineHeight: 1.22,
          letterSpacing: "-0.015em",
          textAlign: "center",
          opacity: interpolate(activeFrame, [0, 8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(activeFrame, [0, 8], ["0px 12px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {active.text.trim()}
      </div>
    </AbsoluteFill>
  );
};
