import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import {
  BRIDGE_KEY,
  Channel,
  type CommitMessage,
  type EventMessage,
  type FramesMessage,
  type GlasskitBridge,
  type IslandCommand,
} from "../shared/protocol.js";

// Preload scripts of one frame share a global, so this also covers a second copy of this file.
const EXPOSED = "__glasskitExposed";

const bridge: GlasskitBridge = {
  capabilities: () => ipcRenderer.invoke(Channel.capabilities),
  commit: (message: CommitMessage) => ipcRenderer.send(Channel.commit, message),
  frames: (message: FramesMessage) => ipcRenderer.send(Channel.frames, message),
  command: (command: IslandCommand) => ipcRenderer.send(Channel.command, command),
  onEvent: (listener) => {
    // The IPC event carries `sender`, which must never reach the page.
    const handler = (_event: IpcRendererEvent, message: EventMessage): void => listener(message);
    ipcRenderer.on(Channel.event, handler);
    return () => {
      ipcRenderer.removeListener(Channel.event, handler);
    };
  },
  onResync: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(Channel.resync, handler);
    return () => {
      ipcRenderer.removeListener(Channel.resync, handler);
    };
  },
};

/**
 * Exposes the glasskit bridge to the page as `window.glasskit`. Runs once on import;
 * calling it again does nothing.
 */
export function exposeGlasskit(): void {
  if (Object.hasOwn(globalThis, EXPOSED)) return;
  Object.defineProperty(globalThis, EXPOSED, { value: true, configurable: true });
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);
  } else {
    Object.defineProperty(globalThis, BRIDGE_KEY, { value: bridge, configurable: true, enumerable: true });
  }
}

exposeGlasskit();
