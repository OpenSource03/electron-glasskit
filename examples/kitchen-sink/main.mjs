// Kitchen sink: every feature of electron-glasskit in one window.
// In your own app, import from "electron-glasskit" instead of the local build.
import path from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { attachGlass, glassWindowOptions, installPreload } from "../../dist/index.js";

const here = import.meta.dirname;
const preload = path.join(here, "preload.cjs");

app.whenReady().then(() => {
  // Adds the glasskit bridge to every page, next to the example's own preload.
  installPreload(session.defaultSession);

  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    title: "electron-glasskit",
    titleBarStyle: "hiddenInset",
    webPreferences: { preload },
  });
  const glass = attachGlass(window);
  // The page places its own glass from the DOM; see index.html.
  glass.connect(window.webContents);
  window.loadFile(path.join(here, "index.html"));

  // HTML on glass: a see-through child window whose page sits on a glass sheet.
  let panel = null;
  let barHeight = 56;
  const barFrame = ({ width, height }) => ({
    x: 300,
    y: height - 24 - barHeight,
    width: width - 350,
    height: barHeight,
  });

  ipcMain.on("demo:html-bar", (_event, visible) => {
    if (!visible) {
      panel?.close();
      panel = null;
      return;
    }
    barHeight = 56;
    panel = glass.createPanel({ frame: barFrame, cornerRadius: 28, window: { webPreferences: { preload } } });
    panel.window.loadFile(path.join(here, "panel.html"));
  });
  ipcMain.on("demo:bar-height", (_event, height) => {
    barHeight = Math.min(Math.max(height, 56), 240);
    panel?.setFrame(barFrame);
  });
  ipcMain.on("demo:send", (_event, text) => window.webContents.send("demo:message", text));

  // A whole window on glass: see-through, with its shadow, corners and traffic lights intact.
  ipcMain.on("demo:glass-window", () => {
    const glassWindow = new BrowserWindow({ width: 520, height: 340, ...glassWindowOptions() });
    attachGlass(glassWindow).setBackground();
    glassWindow.loadFile(path.join(here, "glass-window.html"));
  });

  window.on("closed", () => app.quit());
});
