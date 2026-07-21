import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import { ASSET_CONTRACT_FILENAME, calculateAssetContractHash } from "./asset-contract.mjs";

const manifest = JSON.parse(
  await readFile(new URL(`../public/${ASSET_CONTRACT_FILENAME}`, import.meta.url), "utf8"),
);
const expectedHash = calculateAssetContractHash();

if (manifest.hash !== expectedHash) {
  throw new Error("Narration assets are stale. Run npm run assets before rendering.");
}
