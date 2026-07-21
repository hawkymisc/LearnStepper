/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learnstepper", {
  invoke: (envelope) => ipcRenderer.invoke("learnstepper:invoke", envelope),
  getRuntimeStatus: () => ipcRenderer.invoke("learnstepper:status"),
  startChatGPTLogin: () => ipcRenderer.invoke("learnstepper:auth-login"),
  cancelChatGPTLogin: () => ipcRenderer.invoke("learnstepper:auth-cancel"),
  logoutChatGPT: () => ipcRenderer.invoke("learnstepper:auth-logout"),
  subscribe: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("learnstepper:event", handler);
    return () => ipcRenderer.removeListener("learnstepper:event", handler);
  },
});
