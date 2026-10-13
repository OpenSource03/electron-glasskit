import { afterEach, describe, expect, it, vi } from "vitest";
import { attachGlass, type GlassHost } from "../../../src/main/host.js";
import { setNative } from "../../../src/main/native.js";
import { ui } from "../../../src/shared/nodes.js";
import { Channel } from "../../../src/shared/protocol.js";
import { asContents, asWindow, FakeWebContents, FakeWindow, ipcMain } from "./helpers/electron.js";
import { FakeNative, GLASS_CAPABILITIES } from "./helpers/native.js";
import { stage } from "./helpers/stage.js";

vi.mock("electron", () => import("./helpers/electron.js"));

afterEach(() => {
  setNative(undefined);
});

const FRAME = { x: 10, y: 20, width: 300, height: 100 };
const UNUSABLE = "This window's glass host is no longer usable.";
const INSPECTED_FRAME = { x: 0, y: 0, width: 800, height: 600 };

describe("attachGlass", () => {
  it("returns the same host for the same window", () => {
    const { window, host } = stage();
    expect(attachGlass(asWindow(window))).toBe(host);
  });

  it("returns a different host for a different window", () => {
    const { host } = stage();
    expect(attachGlass(asWindow(new FakeWindow()))).not.toBe(host);
  });

  it("exposes the window it was attached to", () => {
    const { window, host } = stage();
    expect(host.window).toBe(window);
  });

  it("makes no native call until glass is added", () => {
    const { native } = stage();
    expect(native.log).toStrictEqual([]);
  });

  it("creates a new host after the previous one was disposed", () => {
    const { window, host } = stage();
    host.dispose();
    const next = attachGlass(asWindow(window));
    expect(next).not.toBe(host);
    expect(next.isDisposed).toBe(false);
  });

  it("gives the new host a working window after a dispose", () => {
    const { native, window, host } = stage();
    host.dispose();
    const region = attachGlass(asWindow(window)).addRegion({
      frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }),
    });
    window.resizeContent({ width: 500, height: 600 });
    expect(native.framesOf(region.id)).toStrictEqual([[0, 0, 500, 40, 0]]);
  });

  it("answers capability requests from pages, even before any page is connected", () => {
    stage();
    expect(ipcMain.invoke(Channel.capabilities)).toStrictEqual({ ...GLASS_CAPABILITIES, platform: process.platform });
  });

  it("registers the IPC listeners once, however many windows are attached", () => {
    stage();
    stage();
    expect(ipcMain.listenerCount(Channel.commit)).toBe(1);
    expect(ipcMain.listenerCount(Channel.frames)).toBe(1);
    expect(ipcMain.listenerCount(Channel.command)).toBe(1);
  });
});

describe("GlassHost when its window closes", () => {
  it("is disposed", () => {
    const { window, host } = stage();
    window.destroy();
    expect(host.isDisposed).toBe(true);
  });

  it("marks everything it added as removed", () => {
    const { window, host } = stage();
    const group = host.addGroup();
    const objects = [
      host.setBackground(),
      host.addRegion({ frame: FRAME }),
      group,
      group.addRegion({ frame: FRAME }),
      host.addIsland({ frame: FRAME, content: ui.text("Hi") }),
    ];
    window.destroy();
    expect(objects.map((object) => object.isRemoved)).toStrictEqual([true, true, true, true, true]);
  });

  it("no longer has a background", () => {
    const { window, host } = stage();
    host.setBackground();
    window.destroy();
    expect(host.background).toBeNull();
  });

  it("makes no native call that needs the window's handle", () => {
    const { native, window, host } = stage();
    host.setBackground();
    host.addRegion({ frame: FRAME });
    host.addIsland({ frame: FRAME, content: ui.text("Hi") });
    const before = native.log.length;
    window.destroy();
    expect(new Set(native.log.slice(before))).toStrictEqual(new Set(["objectRemove"]));
  });

  it("does not detach from the destroyed window", () => {
    const { native, window, host } = stage();
    host.addRegion({ frame: FRAME });
    window.destroy();
    host.dispose();
    expect(native.calls.hostDetach).toHaveLength(0);
  });

  it("stops listening for the events of its islands", () => {
    const { native, window, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: ui.text("Hi") });
    const listener = vi.fn();
    island.on("press", listener);
    window.destroy();
    native.emit(island.id, { type: "press", node: "go" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns null from inspect without asking the addon", () => {
    const { native, window, host } = stage();
    window.destroy();
    expect(host.inspect()).toBeNull();
    expect(native.calls.hostInspect).toHaveLength(0);
  });

  it.each([
    ["addGroup", (host: GlassHost) => host.addGroup()],
    ["setBackground", (host: GlassHost) => host.setBackground()],
    ["createPanel", (host: GlassHost) => host.createPanel({ frame: FRAME })],
    ["connect", (host: GlassHost) => host.connect(asContents(new FakeWebContents()))],
  ] as const)("throws from %s", (_name, call) => {
    const { window, host } = stage();
    window.destroy();
    expect(() => call(host)).toThrow(UNUSABLE);
  });

  it("throws from addRegion and addIsland", () => {
    const { native, window, host } = stage();
    window.destroy();
    expect(() => host.addRegion({ frame: FRAME })).toThrow();
    expect(() => host.addIsland({ frame: FRAME, content: ui.text("Hi") })).toThrow();
    expect(native.log).toStrictEqual([]);
  });

  it("throws its own error, not Electron's, from addRegion", () => {
    const { window, host } = stage();
    window.destroy();
    expect(() => host.addRegion({ frame: FRAME })).toThrow(UNUSABLE);
  });

  it("lets clearBackground and dispose be called without throwing", () => {
    const { window, host } = stage();
    window.destroy();
    expect(() => {
      host.clearBackground();
      host.dispose();
    }).not.toThrow();
  });
});

describe("GlassHost.dispose on a live window", () => {
  it("detaches from the window", () => {
    const { native, window, host } = stage();
    host.dispose();
    expect(native.calls.hostDetach).toStrictEqual([[window.handle]]);
  });

  it("removes everything it added before detaching", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    const background = host.setBackground();
    host.dispose();
    expect(region.isRemoved && background.isRemoved).toBe(true);
    expect(native.log.at(-1)).toBe("hostDetach");
  });

  it("marks the host disposed", () => {
    const { host } = stage();
    host.dispose();
    expect(host.isDisposed).toBe(true);
  });

  it("detaches once, however often it is called", () => {
    const { native, host } = stage();
    host.dispose();
    host.dispose();
    expect(native.calls.hostDetach).toHaveLength(1);
  });

  it("stops listening for the window's resizes", () => {
    const { window, host } = stage();
    host.dispose();
    expect(window.listenerCount("resize")).toBe(0);
  });

  it("leaves the window open", () => {
    const { window, host } = stage();
    host.dispose();
    expect(window.isDestroyed()).toBe(false);
  });

  it("does nothing more when the window closes later", () => {
    const { native, window, host } = stage();
    host.addRegion({ frame: FRAME });
    host.dispose();
    const before = native.log.length;
    window.destroy();
    expect(native.log.slice(before)).toStrictEqual([]);
  });

  it("disconnects the pages connected through it", () => {
    const { window, host } = stage();
    const contents = new FakeWebContents();
    host.connect(asContents(contents));
    host.dispose();
    expect(() => attachGlass(asWindow(window)).connect(asContents(contents))).not.toThrow();
  });

  it.each([
    ["addRegion", (host: GlassHost) => host.addRegion({ frame: FRAME })],
    ["addGroup", (host: GlassHost) => host.addGroup()],
    ["addIsland", (host: GlassHost) => host.addIsland({ frame: FRAME, content: ui.text("Hi") })],
    ["setBackground", (host: GlassHost) => host.setBackground()],
    ["createPanel", (host: GlassHost) => host.createPanel({ frame: FRAME })],
    ["connect", (host: GlassHost) => host.connect(asContents(new FakeWebContents()))],
  ] as const)("makes %s throw afterwards, without a native call", (_name, call) => {
    const { native, host } = stage();
    host.dispose();
    const before = native.log.length;
    expect(() => call(host)).toThrow(UNUSABLE);
    expect(native.log.slice(before)).toStrictEqual([]);
  });

  it("makes inspect return null afterwards", () => {
    const { native, host } = stage();
    native.inspection = JSON.stringify({ overlay: {}, objects: [] });
    host.dispose();
    expect(host.inspect()).toBeNull();
  });

  it("makes background null afterwards", () => {
    const { host } = stage();
    host.setBackground();
    host.dispose();
    expect(host.background).toBeNull();
  });
});

describe("GlassHost.inspect", () => {
  const overlay = { attached: true, aboveContent: true, frame: INSPECTED_FRAME, contentFrame: INSPECTED_FRAME };

  it("asks the addon about its own window", () => {
    const { native, window, host } = stage();
    host.inspect();
    expect(native.calls.hostInspect).toStrictEqual([[window.handle]]);
  });

  it("returns null where the addon has nothing to report", () => {
    const { native, host } = stage();
    native.inspection = null;
    expect(host.inspect()).toBeNull();
  });

  it("reports a window without a background as the addon does, with null", () => {
    const { native, host } = stage();
    native.inspection = JSON.stringify({ overlay, background: null, objects: [] });
    expect(host.inspect()).toStrictEqual({ overlay, background: null, objects: [] });
  });

  it("returns the addon's background and objects unchanged", () => {
    const { native, host } = stage();
    const background = { viewClass: "NSGlassEffectView", frame: INSPECTED_FRAME };
    const member = { id: 3, kind: "region", viewClass: "NSGlassEffectView", frame: FRAME, zIndex: 0, hidden: false };
    const objects = [
      {
        id: 2,
        kind: "group",
        viewClass: "NSGlassEffectContainerView",
        frame: FRAME,
        zIndex: 1,
        hidden: false,
        members: [member],
      },
    ];
    native.inspection = JSON.stringify({ overlay, background, objects });
    expect(host.inspect()).toStrictEqual({ overlay, background, objects });
  });
});

describe("GlassHost.capabilities", () => {
  it("reports what the addon reports, plus the platform", () => {
    const { host } = stage();
    expect(host.capabilities).toStrictEqual({ ...GLASS_CAPABILITIES, platform: process.platform });
  });

  it("asks the addon each time, so a changed answer is seen", () => {
    const native = new FakeNative();
    setNative(native);
    const host = attachGlass(asWindow(new FakeWindow()));
    native.reported = { ...GLASS_CAPABILITIES, glass: false };
    expect(host.capabilities.glass).toBe(false);
  });
});
