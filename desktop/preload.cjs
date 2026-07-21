/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("learnstepperEligibility", {
  confirm: () => ipcRenderer.invoke("learnstepper:eligibility-confirm"),
});

contextBridge.exposeInMainWorld("learnstepper", {
  invoke: (envelope) => ipcRenderer.invoke("learnstepper:invoke", envelope),
  getRuntimeStatus: () => ipcRenderer.invoke("learnstepper:status"),
  refreshChatGPTLogin: () => ipcRenderer.invoke("learnstepper:auth-refresh"),
  subscribe: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("learnstepper:event", handler);
    return () => ipcRenderer.removeListener("learnstepper:event", handler);
  },
});
