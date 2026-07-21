/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads afterPack as CommonJS */
const { spawn } = require("node:child_process");
const { readdir } = require("node:fs/promises");
const path = require("node:path");

function run(executable, args, acceptedExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (acceptedExitCodes.includes(code)) resolve();
      else reject(new Error(`${path.basename(executable)} exited with ${code}`));
    });
  });
}

async function descendants(root) {
  const paths = [root];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    paths.push(child);
    if (entry.isDirectory()) paths.push(...await descendants(child));
  }
  return paths;
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin" || context.arch !== 3) {
    throw new Error("LearnStepper submission packaging supports macOS arm64 only");
  }
  const application = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const infoPlist = path.join(application, "Contents", "Info.plist");
  await run("/usr/bin/plutil", [
    "-replace", "NSAppTransportSecurity.NSAllowsArbitraryLoads", "-bool", "NO", infoPlist,
  ]);
  for (const key of [
    "NSAudioCaptureUsageDescription",
    "NSBluetoothAlwaysUsageDescription",
    "NSBluetoothPeripheralUsageDescription",
    "NSCameraUsageDescription",
    "NSMicrophoneUsageDescription",
  ]) {
    await run("/usr/bin/plutil", ["-remove", key, infoPlist], [0, 1]);
  }
  const paths = await descendants(application);
  for (let index = 0; index < paths.length; index += 200) {
    await run("/usr/bin/xattr", ["-c", ...paths.slice(index, index + 200)]);
  }
  await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", application]);
};
