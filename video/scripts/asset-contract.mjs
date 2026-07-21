import { createHash } from "node:crypto";

import { FPS, SCENES } from "../src/timeline.mjs";

export const ASSET_CONTRACT_FILENAME = "asset-contract.json";
export const VOICE_NAME = "Samantha";
export const VOICE_RATE = 168;
export const AUDIO_DELAY_MS = 200;
export const CAPTION_START_OFFSET_MS = 160;
export const CAPTION_END_PADDING_MS = 220;

export const calculateAssetContractHash = () =>
  createHash("sha256")
    .update(
      JSON.stringify({
        fps: FPS,
        scenes: SCENES,
        voiceName: VOICE_NAME,
        voiceRate: VOICE_RATE,
        audioDelayMs: AUDIO_DELAY_MS,
        captionStartOffsetMs: CAPTION_START_OFFSET_MS,
        captionEndPaddingMs: CAPTION_END_PADDING_MS,
      }),
    )
    .digest("hex");
