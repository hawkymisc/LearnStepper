import { Audio } from "@remotion/media";
import {
  AbsoluteFill,
  Composition,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { CaptionLayer } from "./CaptionLayer";
import {
  DEMO_DISCLOSURE,
  FPS,
  HEIGHT,
  SCENES,
  TOTAL_DURATION_IN_FRAMES,
  WIDTH,
} from "./timeline.mjs";

const COLORS = {
  ink: "#092f52",
  navy: "#072b4b",
  blue: "#1680c4",
  cyan: "#76d8ed",
  paper: "#f5f3ed",
  pale: "#eaf4fb",
  white: "#ffffff",
  green: "#148a7b",
};

const Brand: React.FC<{ inverse?: boolean }> = ({ inverse = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 18,
      color: inverse ? COLORS.white : COLORS.ink,
    }}
  >
    <div
      style={{
        width: 58,
        height: 58,
        borderRadius: 18,
        display: "grid",
        placeItems: "center",
        color: COLORS.white,
        background: `linear-gradient(145deg, ${COLORS.blue}, ${COLORS.ink})`,
        fontFamily: "Georgia, serif",
        fontSize: 34,
      }}
    >
      L
    </div>
    <div
      style={{
        fontFamily: "Georgia, serif",
        fontSize: 38,
        letterSpacing: "-0.035em",
      }}
    >
      Learn<span style={{ color: COLORS.blue }}>Stepper</span>
    </div>
  </div>
);

const SceneChrome: React.FC<{ inverse?: boolean }> = ({ inverse = false }) => (
  <>
    <div style={{ position: "absolute", top: 70, left: 92 }}>
      <Brand inverse={inverse} />
    </div>
    <div
      style={{
        position: "absolute",
        top: 88,
        right: 92,
        color: inverse ? "rgba(255,255,255,0.62)" : "rgba(9,47,82,0.55)",
        fontSize: 24,
        fontWeight: 750,
        letterSpacing: "0.16em",
      }}
    >
      OPENAI BUILD WEEK · EDUCATION
    </div>
  </>
);

const AnimatedBackdrop: React.FC<{ inverse?: boolean }> = ({ inverse = false }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background: inverse
          ? `linear-gradient(145deg, ${COLORS.navy} 0%, #0a416d 100%)`
          : `linear-gradient(145deg, ${COLORS.paper} 0%, ${COLORS.pale} 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 720,
          height: 720,
          borderRadius: "50%",
          top: -330,
          right: -160,
          backgroundColor: inverse
            ? "rgba(118,216,237,0.13)"
            : "rgba(22,128,196,0.12)",
          scale: interpolate(frame, [0, 450], [0.9, 1.12], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 460,
          height: 460,
          borderRadius: "50%",
          bottom: -210,
          left: -110,
          border: `2px solid ${inverse ? "rgba(255,255,255,0.12)" : "rgba(22,128,196,0.14)"}`,
          translate: interpolate(frame, [0, 450], ["0px 20px", "40px -10px"], {
            extrapolateRight: "clamp",
          }),
        }}
      />
    </AbsoluteFill>
  );
};

const FadeEnvelope: React.FC<React.PropsWithChildren<{ duration: number }>> = ({
  children,
  duration,
}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const MessageScene: React.FC<{ scene: (typeof SCENES)[number] }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const inverse = scene.id === "access" || scene.id === "close";

  return (
    <FadeEnvelope duration={scene.durationInFrames}>
      <AnimatedBackdrop inverse={inverse} />
      <SceneChrome inverse={inverse} />
      <AbsoluteFill
        style={{
          padding: "220px 150px 250px",
          justifyContent: "center",
          color: inverse ? COLORS.white : COLORS.ink,
        }}
      >
        <div
          style={{
            maxWidth: scene.id === "access" ? 1480 : 1420,
            display: "flex",
            flexDirection: "column",
            gap: 34,
            opacity: interpolate(frame, [5, 24], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(frame, [5, 24], ["0px 38px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <div
            style={{
              color: inverse ? COLORS.cyan : COLORS.blue,
              fontSize: 27,
              fontWeight: 850,
              letterSpacing: "0.18em",
            }}
          >
            {scene.eyebrow}
          </div>
          <div
            style={{
              maxWidth: 1480,
              fontFamily: "Georgia, serif",
              fontSize: scene.id === "access" ? 124 : 112,
              lineHeight: 0.98,
              letterSpacing: "-0.048em",
            }}
          >
            {scene.headline}
          </div>
          <div
            style={{
              maxWidth: 1280,
              fontSize: 45,
              lineHeight: 1.3,
              color: inverse ? "rgba(255,255,255,0.76)" : "rgba(9,47,82,0.72)",
            }}
          >
            {scene.subhead}
          </div>
        </div>
      </AbsoluteFill>
    </FadeEnvelope>
  );
};

const DemoScene: React.FC<{ scene: (typeof SCENES)[number] }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const duration = scene.durationInFrames;
  const horizontalMove =
    scene.focus === "right"
      ? ["-12px 0px", "-52px -10px"]
      : scene.focus === "left"
        ? ["12px 0px", "46px -8px"]
        : ["0px 0px", "0px -14px"];

  return (
    <FadeEnvelope duration={duration}>
      <AnimatedBackdrop />
      <SceneChrome />
      <AbsoluteFill style={{ padding: "162px 92px 98px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "end",
              justifyContent: "space-between",
              gap: 52,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  color: COLORS.blue,
                  fontSize: 24,
                  fontWeight: 850,
                  letterSpacing: "0.18em",
                }}
              >
                {scene.eyebrow}
              </div>
              <div
                style={{
                  color: COLORS.ink,
                  fontFamily: "Georgia, serif",
                  fontSize: 70,
                  lineHeight: 1.02,
                  letterSpacing: "-0.04em",
                }}
              >
                {scene.headline}
              </div>
            </div>
            <div
              style={{
                maxWidth: 760,
                paddingBottom: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 18px",
                  borderRadius: 999,
                  color: COLORS.ink,
                  backgroundColor: "rgba(255,255,255,0.94)",
                  border: "1px solid rgba(9,47,82,0.18)",
                  boxShadow: "0 10px 28px rgba(7,43,75,0.12)",
                  fontSize: 28,
                  fontWeight: 720,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: COLORS.green, fontSize: 22 }}>●</span>
                {scene.disclosure ?? DEMO_DISCLOSURE}
              </div>
              <div
                style={{
                  color: "rgba(9,47,82,0.68)",
                  fontSize: 29,
                  lineHeight: 1.25,
                  textAlign: "right",
                }}
              >
                {scene.subhead}
              </div>
            </div>
          </div>
          <div
            style={{
              width: 1580,
              height: 640,
              overflow: "hidden",
              position: "relative",
              border: "1px solid rgba(9,47,82,0.16)",
              borderRadius: 28,
              backgroundColor: COLORS.white,
              boxShadow: "0 28px 80px rgba(7,43,75,0.2)",
              opacity: interpolate(frame, [8, 25], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
              scale: interpolate(frame, [8, 25], [0.97, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }),
            }}
          >
            <div
              style={{
                height: 42,
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingLeft: 20,
                backgroundColor: "#eef3f7",
                borderBottom: "1px solid rgba(9,47,82,0.1)",
              }}
            >
              {["#ff766f", "#f3c74f", "#62c46f"].map((color) => (
                <div
                  key={color}
                  style={{ width: 13, height: 13, borderRadius: "50%", backgroundColor: color }}
                />
              ))}
            </div>
            <Img
              src={staticFile(scene.asset ?? "")}
              style={{
                width: "100%",
                height: "calc(100% - 42px)",
                objectFit: "cover",
                objectPosition: scene.id === "learning-loop" ? "center bottom" : "top center",
                scale: interpolate(frame, [0, duration], [1.02, 1.085], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
                translate: interpolate(frame, [0, duration], horizontalMove, {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
    </FadeEnvelope>
  );
};

const ProofScene: React.FC<{ scene: (typeof SCENES)[number] }> = ({ scene }) => {
  const frame = useCurrentFrame();

  return (
    <FadeEnvelope duration={scene.durationInFrames}>
      <AnimatedBackdrop inverse />
      <SceneChrome inverse />
      <AbsoluteFill
        style={{
          padding: "210px 120px 250px",
          color: COLORS.white,
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 46 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                color: COLORS.cyan,
                fontSize: 26,
                fontWeight: 850,
                letterSpacing: "0.18em",
              }}
            >
              {scene.eyebrow}
            </div>
            <div
              style={{
                maxWidth: 1420,
                fontFamily: "Georgia, serif",
                fontSize: 90,
                lineHeight: 1,
                letterSpacing: "-0.045em",
              }}
            >
              {scene.headline}
            </div>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {(scene.metrics ?? []).map(([value, label], index) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  padding: "32px 36px 34px",
                  borderRadius: 24,
                  border: "1px solid rgba(255,255,255,0.2)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  opacity: interpolate(frame, [18 + index * 8, 34 + index * 8], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                  translate: interpolate(
                    frame,
                    [18 + index * 8, 34 + index * 8],
                    ["0px 24px", "0px 0px"],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  ),
                }}
              >
                <div style={{ color: COLORS.cyan, fontSize: 52, fontWeight: 800 }}>{value}</div>
                <div style={{ marginTop: 8, fontSize: 29, color: "rgba(255,255,255,0.68)" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 32, color: "rgba(255,255,255,0.66)" }}>{scene.subhead}</div>
        </div>
      </AbsoluteFill>
    </FadeEnvelope>
  );
};

const Scene: React.FC<{ scene: (typeof SCENES)[number] }> = ({ scene }) => {
  if (scene.kind === "demo") {
    return <DemoScene scene={scene} />;
  }
  if (scene.kind === "proof") {
    return <ProofScene scene={scene} />;
  }
  return <MessageScene scene={scene} />;
};

export const LearnStepperBuildWeek: React.FC = () => (
  <AbsoluteFill style={{ fontFamily: "Arial, Helvetica, sans-serif", backgroundColor: COLORS.navy }}>
    {SCENES.map((scene) => (
      <Sequence
        key={scene.id}
        from={scene.startFrame}
        durationInFrames={scene.durationInFrames}
        name={scene.headline}
      >
        <Scene scene={scene} />
      </Sequence>
    ))}
    <Audio src={staticFile("narration.wav")} />
    <CaptionLayer />
  </AbsoluteFill>
);

export const MyComposition = () => (
  <Composition
    id="LearnStepperBuildWeek"
    component={LearnStepperBuildWeek}
    durationInFrames={TOTAL_DURATION_IN_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{}}
  />
);
