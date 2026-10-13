import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIDGE_KEY, Channel, type EventMessage, type GlasskitBridge } from "../../../src/shared/protocol.js";

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}));
vi.mock("electron", () => electron);

const globals: Record<string, unknown> = globalThis;

function setIsolation(isolated: boolean): void {
  Object.defineProperty(process, "contextIsolated", { value: isolated, configurable: true });
}

async function load(): Promise<typeof import("../../../src/preload/index.js")> {
  vi.resetModules();
  return import("../../../src/preload/index.js");
}

function exposedBridge(): GlasskitBridge {
  const call = electron.contextBridge.exposeInMainWorld.mock.calls[0];
  if (!call) throw new Error("the bridge was not exposed");
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete globals.__glasskitExposed;
  delete globals[BRIDGE_KEY];
  Reflect.deleteProperty(process, "contextIsolated");
});

describe("exposeGlasskit", () => {
  it("exposes the bridge through contextBridge when the context is isolated", async () => {
    setIsolation(true);
    await load();
    expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledExactlyOnceWith(BRIDGE_KEY, expect.any(Object));
    expect(globals[BRIDGE_KEY]).toBeUndefined();
  });

  it("assigns the bridge to the global when the context is not isolated", async () => {
    setIsolation(false);
    await load();
    expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
    expect(globals[BRIDGE_KEY]).toEqual(expect.objectContaining({ commit: expect.any(Function) }));
  });

  it("exposes once, however often it is called or loaded", async () => {
    setIsolation(true);
    const { exposeGlasskit } = await load();
    exposeGlasskit();
    await load();
    expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
  });

  it("exposes exactly the bridge interface", async () => {
    setIsolation(true);
    await load();
    expect(Object.keys(exposedBridge()).sort()).toEqual([
      "capabilities",
      "command",
      "commit",
      "frames",
      "onEvent",
      "onResync",
    ]);
  });

  it("routes each method to its own channel", async () => {
    setIsolation(true);
    await load();
    const bridge = exposedBridge();
    electron.ipcRenderer.invoke.mockResolvedValue({ glass: true });

    await expect(bridge.capabilities()).resolves.toEqual({ glass: true });
    bridge.commit({ items: [], groups: {} });
    bridge.frames([["region:1", 1, 2, 3, 4]]);
    bridge.command({ type: "focus", key: "island:1", node: "field" });

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(Channel.capabilities);
    expect(electron.ipcRenderer.send.mock.calls).toEqual([
      [Channel.commit, { items: [], groups: {} }],
      [Channel.frames, [["region:1", 1, 2, 3, 4]]],
      [Channel.command, { type: "focus", key: "island:1", node: "field" }],
    ]);
  });

  it("delivers events without the IPC event object and unsubscribes", async () => {
    setIsolation(true);
    await load();
    const listener = vi.fn();
    const unsubscribe = exposedBridge().onEvent(listener);

    const [channel, handler] = electron.ipcRenderer.on.mock.calls[0] ?? [];
    expect(channel).toBe(Channel.event);
    const message: EventMessage = { key: "island:1", event: { type: "press", node: "send" } };
    handler({ sender: "ipc" }, message);
    expect(listener.mock.calls).toEqual([[message]]);

    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(Channel.event, handler);
  });

  it("delivers resync requests without the IPC event object and unsubscribes", async () => {
    setIsolation(true);
    await load();
    const listener = vi.fn();
    const unsubscribe = exposedBridge().onResync(listener);

    const [channel, handler] = electron.ipcRenderer.on.mock.calls[0] ?? [];
    expect(channel).toBe(Channel.resync);
    handler({ sender: "ipc" });
    expect(listener.mock.calls).toEqual([[]]);

    unsubscribe();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(Channel.resync, handler);
  });
});
