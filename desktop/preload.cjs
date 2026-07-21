// Electron preload scripts use CommonJS when sandboxing is enabled.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learnstepper", {
  invoke: (envelope) => ipcRenderer.invoke("learnstepper:invoke", envelope),
  getRuntimeStatus: () => ipcRenderer.invoke("learnstepper:status"),
  subscribe: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("learnstepper:event", handler);
    return () => ipcRenderer.removeListener("learnstepper:event", handler);
  },
});
