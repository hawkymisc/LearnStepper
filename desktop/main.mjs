import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createAuthenticationRefresher } from "./auth-refresh.mjs";
import { SidecarClient } from "./sidecar-client.mjs";
import { createEligibilityGate } from "./eligibility.mjs";
import { bootstrapDesktop, desktopEnvironment, rendererLifetime, rendererRuntime, sidecarRuntime } from "./runtime.mjs";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = app.isPackaged ? app.getAppPath() : path.resolve(desktopDirectory, "..");
let sidecar;
let mainWindow;
let rendererProcess;
let rendererLifecycle;
let trustedRendererUrl;
let activeRendererUrl;

app.setName("LearnStepper");

async function createSidecar() {
  const runtime = sidecarRuntime({
    packaged: app.isPackaged,
    appRoot: repositoryRoot,
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
  });
  const child = spawn(
    runtime.executable,
    runtime.args,
    { cwd: repositoryRoot, env: runtime.environment, stdio: ["pipe", "pipe", "ignore"] },
  );
  const candidate = new SidecarClient(child);
  try {
    await candidate.status();
    return candidate;
  } catch (error) {
    candidate.close();
    throw error;
  }
}

function activateSidecar(candidate) {
  candidate.subscribe((event) => mainWindow?.webContents.send("learnstepper:event", event));
}

async function startSidecar() {
  const initial = await createSidecar();
  activateSidecar(initial);
  sidecar = initial;
}

const refreshSidecarAuthentication = createAuthenticationRefresher({
  createSidecar,
  getCurrent: () => sidecar,
  setCurrent: (candidate) => { sidecar = candidate; },
  activate: activateSidecar,
});

const eligibilityGate = createEligibilityGate(startSidecar);

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

function waitForRenderer(rendererUrl, launchToken) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30_000;
    const attempt = async () => {
      if (rendererProcess?.exitCode !== null) {
        reject(new Error("Bundled Renderer stopped during startup"));
        return;
      }
      try {
        const response = await fetch(rendererUrl, { redirect: "error" });
        const html = await response.text();
        if (response.ok && html.includes(`<meta name="learnstepper-renderer" content="${launchToken}"`)) {
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
  const port = app.isPackaged ? await availablePort() : 3010;
  const launchToken = randomBytes(32).toString("hex");
  const runtime = rendererRuntime({ packaged: app.isPackaged, appRoot: repositoryRoot, electronPath: process.execPath, port, launchToken });
  if (runtime.command === null) return runtime.url;
  rendererProcess = spawn(runtime.command.executable, runtime.command.args, {
    cwd: repositoryRoot,
    env: { ...desktopEnvironment(), ...runtime.command.environment },
    stdio: "ignore",
  });
  rendererLifecycle = rendererLifetime(rendererProcess, () => {
    trustedRendererUrl = undefined;
    activeRendererUrl = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    createRecoveryWindow();
  });
  await waitForRenderer(runtime.url, launchToken);
  rendererLifecycle.trust();
  return runtime.url;
}

function createWindow(rendererUrl) {
  trustedRendererUrl = rendererUrl;
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
    if (destination !== trustedRendererUrl) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void mainWindow.loadURL(rendererUrl);
}

function createRecoveryWindow() {
  mainWindow = new BrowserWindow({ width: 760, height: 520, webPreferences: { sandbox: true } });
  const html = "<!doctype html><meta charset=utf-8><title>LearnStepper</title><style>body{font:16px system-ui;padding:48px;color:#123;background:#f4f8fc}main{max-width:560px;margin:auto}h1{color:#063c70}</style><main><h1>LearnStepperを起動できません</h1><p>内蔵画面の起動に失敗しました。アプリを終了して、もう一度起動してください。</p></main>";
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function assertTrustedSender(event) {
  if (!trustedRendererUrl || event.senderFrame?.url !== trustedRendererUrl) {
    throw new Error("Untrusted LearnStepper IPC sender");
  }
}

app.whenReady().then(async () => {
  ipcMain.handle("learnstepper:eligibility-confirm", async (event) => {
    assertTrustedSender(event);
    await eligibilityGate.confirm();
    return { state: "ready" };
  });
  ipcMain.handle("learnstepper:invoke", async (event, envelope) => {
    assertTrustedSender(event);
    await eligibilityGate.requireReady();
    return sidecar.invoke(envelope);
  });
  ipcMain.handle("learnstepper:status", async (event) => {
    assertTrustedSender(event);
    await eligibilityGate.requireReady();
    return sidecar.status();
  });
  ipcMain.handle("learnstepper:auth-refresh", async (event) => {
    assertTrustedSender(event);
    await eligibilityGate.requireReady();
    return refreshSidecarAuthentication();
  });
  activeRendererUrl = await bootstrapDesktop({ startRenderer, createWindow, createRecoveryWindow });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (activeRendererUrl) createWindow(activeRendererUrl);
      else createRecoveryWindow();
    }
  });
});

app.on("before-quit", () => { sidecar?.close(); rendererLifecycle?.stop(); rendererProcess?.kill(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
