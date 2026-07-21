import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SidecarClient } from "./sidecar-client.mjs";
import { bootstrapDesktop, createRendererLifecycle, desktopEnvironment, normalizeRendererUrl, rendererRuntime, resolveDesktopExecutable, sidecarRuntime, watchRendererProcess } from "./runtime.mjs";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = app.isPackaged ? app.getAppPath() : path.resolve(desktopDirectory, "..");
let sidecar;
let sidecarReady;
let mainWindow;
let rendererProcess;
let trustedRendererUrl;
let quitting = false;
let rendererFailureError;
const rendererLifecycle = createRendererLifecycle();

app.setName("LearnStepper");

async function startSidecar() {
  const runtime = sidecarRuntime({
    appRoot: repositoryRoot,
    userData: app.getPath("userData"),
  });
  const child = spawn(
    runtime.executable,
    runtime.args,
    { cwd: repositoryRoot, env: runtime.environment, stdio: ["pipe", "pipe", "ignore"] },
  );
  sidecar = new SidecarClient(child);
  sidecar.subscribe((event) => mainWindow?.webContents.send("learnstepper:event", event));
  await sidecar.status();
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForRenderer(rendererUrl, nonce) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const attempt = async () => {
      if (rendererFailureError) {
        reject(rendererFailureError);
        return;
      }
      if (rendererProcess?.exitCode !== null) {
        reject(new Error("Bundled Renderer stopped during startup"));
        return;
      }
      try {
        const response = await fetch(rendererUrl, { redirect: "error" });
        const html = await response.text();
        const marker = `<meta name="learnstepper-boot-nonce" content="${nonce}"`;
        if (response.ok && html.includes("<title>LearnStepper") && html.includes(marker)) {
          resolve();
          return;
        }
      } catch {
        // The child needs a short interval to bind its loopback port.
      }
      if (Date.now() >= deadline) reject(new Error("Bundled Renderer did not start"));
      else setTimeout(attempt, 200);
    };
    void attempt();
  });
}

async function startRenderer() {
  const port = await availablePort();
  const nonce = randomBytes(32).toString("hex");
  const environment = desktopEnvironment();
  const runtime = rendererRuntime({
    packaged: app.isPackaged,
    appRoot: repositoryRoot,
    electronPath: process.execPath,
    npmPath: app.isPackaged ? undefined : resolveDesktopExecutable("npm", environment),
    port,
    nonce,
  });
  rendererProcess = spawn(runtime.command.executable, runtime.command.args, {
    cwd: repositoryRoot,
    env: { ...environment, ...runtime.command.environment },
    stdio: "ignore",
  });
  rendererFailureError = null;
  watchRendererProcess(rendererProcess, (error) => {
    rendererFailureError = error;
    rendererLifecycle.fail();
    trustedRendererUrl = null;
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
      createRecoveryWindow();
    }
  });
  await waitForRenderer(runtime.url, nonce);
  if (rendererFailureError) throw rendererFailureError;
  rendererLifecycle.activate(runtime.url);
  return runtime.url;
}

function createWindow(rendererUrl) {
  trustedRendererUrl = normalizeRendererUrl(rendererUrl);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 700,
    webPreferences: {
      preload: path.join(desktopDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.on("will-navigate", (event, destination) => {
    if (normalizeRendererUrl(destination) !== trustedRendererUrl) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void mainWindow.loadURL(rendererUrl);
}

function createRecoveryWindow() {
  rendererLifecycle.fail();
  trustedRendererUrl = null;
  mainWindow = new BrowserWindow({ width: 760, height: 520, webPreferences: { sandbox: true } });
  const html = "<!doctype html><meta charset=utf-8><title>LearnStepper</title><style>body{font:16px system-ui;padding:48px;color:#123;background:#f4f8fc}main{max-width:560px;margin:auto}h1{color:#063c70}</style><main><h1>LearnStepperを起動できません</h1><p>内蔵画面の起動に失敗しました。アプリを終了して、もう一度起動してください。</p></main>";
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function assertTrustedSender(event) {
  let senderUrl;
  try {
    senderUrl = normalizeRendererUrl(event.senderFrame?.url ?? "");
  } catch {
    senderUrl = null;
  }
  if (!trustedRendererUrl || senderUrl !== trustedRendererUrl) {
    throw new Error("Untrusted LearnStepper IPC sender");
  }
}

app.whenReady().then(async () => {
  sidecarReady = startSidecar();
  void sidecarReady.catch(() => undefined);
  ipcMain.handle("learnstepper:invoke", async (event, envelope) => {
    assertTrustedSender(event);
    await sidecarReady;
    return sidecar.invoke(envelope);
  });
  ipcMain.handle("learnstepper:status", async (event) => {
    assertTrustedSender(event);
    await sidecarReady;
    return sidecar.status();
  });
  await bootstrapDesktop({
    startRenderer,
    isRendererAvailable: (rendererUrl) => (
      !rendererFailureError && rendererLifecycle.current() === normalizeRendererUrl(rendererUrl)
    ),
    createWindow,
    createRecoveryWindow,
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const rendererUrl = rendererLifecycle.current();
      if (rendererUrl) createWindow(rendererUrl);
      else createRecoveryWindow();
    }
  });
});

app.on("before-quit", () => { quitting = true; sidecar?.close(); rendererProcess?.kill(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
