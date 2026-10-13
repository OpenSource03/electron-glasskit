// The example's own IPC. The glasskit bridge comes from installPreload() in main.mjs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("demo", {
  setHtmlBar: (visible) => ipcRenderer.send("demo:html-bar", visible),
  setBarHeight: (height) => ipcRenderer.send("demo:bar-height", height),
  send: (text) => ipcRenderer.send("demo:send", text),
  openGlassWindow: () => ipcRenderer.send("demo:glass-window"),
  onMessage: (listener) => ipcRenderer.on("demo:message", (_event, text) => listener(text)),
});
