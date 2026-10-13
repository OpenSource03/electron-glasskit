import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNative } from "../../../src/main/native.js";
import type { GlassPanel, GlassPanelOptions } from "../../../src/main/panel.js";
import { FakeBrowserWindow, type FakeWindow } from "./helpers/electron.js";
import { decode } from "./helpers/native.js";
import { type Stage, stage } from "./helpers/stage.js";

vi.mock("electron", () => import("./helpers/electron.js"));

beforeEach(() => {
  FakeBrowserWindow.created.length = 0;
});

afterEach(() => {
  setNative(undefined);
});

const FRAME = { x: 10, y: 20, width: 200, height: 100 };

interface Opened extends Stage {
  parent: FakeWindow;
  panel: GlassPanel;
  /** The panel's own window. */
  child: FakeBrowserWindow;
}

/** Opens a panel in a parent whose content area starts at (100, 50) on screen. */
function open(options: GlassPanelOptions = { frame: FRAME }): Opened {
  const staged = stage();
  staged.window.content = { x: 100, y: 50, width: 800, height: 600 };
  const panel = staged.host.createPanel(options);
  return { ...staged, parent: staged.window, panel, child: FakeBrowserWindow.latest() };
}

describe("GlassPanel window", () => {
  it("is the window the panel exposes", () => {
    const { panel, child } = open();
    expect(panel.window).toBe(child);
  });

  it("is a child of the host's window", () => {
    const { parent, child } = open();
    expect(child.options.parent).toBe(parent);
  });

  it("sits at the parent's content origin plus the frame", () => {
    const { child } = open();
    expect(child.options).toMatchObject({ x: 110, y: 70, width: 200, height: 100 });
  });

  it("rounds its bounds to whole points", () => {
    const { child } = open({ frame: { x: 10.4, y: 20.6, width: 200.5, height: 99.4 } });
    expect(child.options).toMatchObject({ x: 110, y: 71, width: 201, height: 99 });
  });

  it("resolves a function frame against the parent's content size", () => {
    const { child } = open({
      frame: ({ width, height }) => ({ x: width - 200, y: height - 100, width: 200, height: 100 }),
    });
    expect(child.options).toMatchObject({ x: 700, y: 550, width: 200, height: 100 });
  });

  it("is frameless, see-through, fixed in place and created hidden", () => {
    const { child } = open();
    expect(child.options).toMatchObject({
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
    });
  });

  it("passes extra window options through", () => {
    const { child } = open({ frame: FRAME, window: { title: "Inspector", webPreferences: { sandbox: true } } });
    expect(child.options).toMatchObject({ title: "Inspector", webPreferences: { sandbox: true } });
  });

  it("does not let extra window options override the forced ones, the bounds or the parent", () => {
    const { parent, child } = open({
      frame: FRAME,
      window: {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        frame: true,
        transparent: false,
        backgroundColor: "#ffffff",
        hasShadow: true,
        resizable: true,
        movable: true,
        minimizable: true,
        maximizable: true,
        fullscreenable: true,
        skipTaskbar: false,
        show: true,
      },
    });
    expect(child.options).toStrictEqual({
      x: 110,
      y: 70,
      width: 200,
      height: 100,
      parent,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
    });
  });

  it("is shown without taking focus by default", () => {
    const { child } = open();
    expect(child.shownInactive).toBe(true);
  });

  it("stays hidden with `show: false`", () => {
    const { child } = open({ frame: FRAME, show: false });
    expect(child.shownInactive).toBe(false);
  });

  it("is not created when the frame is invalid", () => {
    const { host } = stage();
    expect(() => host.createPanel({ frame: { ...FRAME, x: Number.NaN } })).toThrow(TypeError);
    expect(FakeBrowserWindow.created).toHaveLength(0);
  });

  it("leaves the parent unwatched when the glass options are rejected", () => {
    const { window, host } = stage();
    expect(() => host.createPanel({ frame: FRAME, tint: "red" })).toThrow('Invalid colour "red".');
    expect(window.listenerCount("move")).toBe(0);
  });

  it("is not left behind when the glass options are rejected", () => {
    const { host } = stage();
    expect(() => host.createPanel({ frame: FRAME, tint: "red" })).toThrow(TypeError);
    expect(FakeBrowserWindow.created.filter((window) => !window.isDestroyed())).toHaveLength(0);
  });
});

describe("GlassPanel glass", () => {
  it("puts a glass background on the panel's own window", () => {
    const { native, child } = open();
    expect(native.calls.backgroundSet).toHaveLength(1);
    expect(native.calls.backgroundSet[0]?.[0]).toBe(child.handle);
  });

  it("sends the glass options, and none of the panel's own", () => {
    const { native } = open({
      frame: FRAME,
      show: false,
      window: { title: "Inspector" },
      tint: "#fff",
      cornerRadius: 12,
      style: "clear",
    });
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({
      cornerRadius: 12,
      style: "clear",
      tint: "#FFFFFFFF",
    });
  });

  it("updates that background through update", () => {
    const { native, panel } = open();
    expect(panel.update({ tint: null, opaque: true })).toBe(panel);
    expect(native.calls.objectUpdate.map(([, options]) => decode(options))).toStrictEqual([
      { opaque: true, tint: null },
    ]);
  });

  it("adds nothing to the parent window", () => {
    const { host } = open();
    expect(host.background).toBeNull();
  });
});

describe("GlassPanel position", () => {
  it("follows the parent when it resizes", () => {
    const { parent, child } = open({ frame: ({ width }) => ({ x: width - 200, y: 0, width: 200, height: 100 }) });
    parent.resizeContent({ width: 1000, height: 600 });
    expect(child.boundsSet).toStrictEqual([{ x: 900, y: 50, width: 200, height: 100 }]);
  });

  it("follows the parent when it moves", () => {
    const { parent, child } = open();
    parent.moveContent(300, 400);
    expect(child.boundsSet).toStrictEqual([{ x: 310, y: 420, width: 200, height: 100 }]);
  });

  it("moves when setFrame is called", () => {
    const { panel, child } = open();
    expect(panel.setFrame({ x: 0.5, y: 1.4, width: 50, height: 60 })).toBe(panel);
    expect(child.boundsSet).toStrictEqual([{ x: 101, y: 51, width: 50, height: 60 }]);
  });

  it("reports its frame in the parent's content coordinates", () => {
    const { panel } = open();
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("reports a function frame as resolved against the parent's current size", () => {
    const { parent, panel } = open({ frame: ({ width }) => ({ x: width - 200, y: 0, width: 200, height: 100 }) });
    parent.resizeContent({ width: 1000, height: 600 });
    expect(panel.frame).toStrictEqual({ x: 800, y: 0, width: 200, height: 100 });
  });

  it("reports the frame given to setFrame", () => {
    const { panel } = open();
    panel.setFrame({ x: 1, y: 2, width: 3, height: 4 });
    expect(panel.frame).toStrictEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

describe("GlassPanel frame", () => {
  it("is a copy, so changing it changes nothing", () => {
    const { panel } = open();
    panel.frame.x = 999;
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("has a negative size clamped to zero", () => {
    const { panel } = open({ frame: { x: 1, y: 2, width: -5, height: -5 } });
    expect(panel.frame).toStrictEqual({ x: 1, y: 2, width: 0, height: 0 });
  });

  it("is still readable after the panel is closed", () => {
    const { panel } = open();
    panel.close();
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("is still readable after the parent window is destroyed", () => {
    const { parent, panel } = open();
    parent.destroy();
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("keeps the last applied frame when setFrame is called on a closed panel", () => {
    const { panel } = open();
    panel.close();
    expect(panel.setFrame({ x: 0, y: 0, width: 1, height: 1 })).toBe(panel);
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("ignores setFrame once the parent window is destroyed", () => {
    const { parent, panel } = open();
    parent.destroy();
    expect(() => panel.setFrame({ x: 0, y: 0, width: 1, height: 1 })).not.toThrow();
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("rejects an invalid frame in setFrame without moving the window", () => {
    const { panel, child } = open();
    expect(() => panel.setFrame({ ...FRAME, y: Number.NaN })).toThrow('Invalid frame: "y"');
    expect(child.boundsSet).toStrictEqual([]);
    expect(panel.frame).toStrictEqual(FRAME);
  });

  it("keeps following the previous frame after a rejected setFrame", () => {
    const { parent, panel, child } = open({
      frame: ({ width }) => ({ x: width - 200, y: 0, width: 200, height: 100 }),
    });
    expect(() => panel.setFrame(() => ({ x: Number.NaN, y: 0, width: 1, height: 1 }))).toThrow(TypeError);
    parent.resizeContent({ width: 1000, height: 600 });
    expect(child.boundsSet).toStrictEqual([{ x: 900, y: 50, width: 200, height: 100 }]);
  });
});

describe("GlassPanel closing", () => {
  it("destroys its window", () => {
    const { panel, child } = open();
    panel.close();
    expect(child.isDestroyed()).toBe(true);
  });

  it("can be closed twice", () => {
    const { panel } = open();
    panel.close();
    expect(() => panel.close()).not.toThrow();
  });

  it("removes the glass behind the panel", () => {
    const { native, panel } = open();
    const backgroundId = native.lastId;
    panel.close();
    expect(native.removed()).toStrictEqual([backgroundId]);
  });

  it("stops listening to the parent", () => {
    const staged = stage();
    const before = { resize: staged.window.listenerCount("resize"), move: staged.window.listenerCount("move") };
    const panel = staged.host.createPanel({ frame: FRAME });
    expect(staged.window.listenerCount("move")).toBe(before.move + 1);
    panel.close();
    expect({ resize: staged.window.listenerCount("resize"), move: staged.window.listenerCount("move") }).toStrictEqual(
      before,
    );
  });

  it("stops listening to the parent when the user closes the panel's window", () => {
    const { parent, child } = open();
    child.destroy();
    expect(parent.listenerCount("move")).toBe(0);
  });

  it("no longer follows the parent", () => {
    const { parent, panel, child } = open();
    panel.close();
    parent.resizeContent({ width: 1000, height: 600 });
    parent.moveContent(0, 0);
    expect(child.boundsSet).toStrictEqual([]);
  });

  it("makes setFrame a no-op", () => {
    const { panel, child } = open();
    panel.close();
    expect(() => panel.setFrame({ x: 0, y: 0, width: 1, height: 1 })).not.toThrow();
    expect(child.boundsSet).toStrictEqual([]);
  });

  it("happens when the host is disposed", () => {
    const { host, child } = open();
    host.dispose();
    expect(child.isDestroyed()).toBe(true);
  });

  it("happens when the parent window closes, without touching the destroyed parent", () => {
    const { parent, child } = open();
    expect(() => parent.destroy()).not.toThrow();
    expect(child.isDestroyed()).toBe(true);
  });

  it("closes every panel of the host", () => {
    const { host } = open();
    host.createPanel({ frame: FRAME });
    host.dispose();
    expect(FakeBrowserWindow.created.map((window) => window.isDestroyed())).toStrictEqual([true, true]);
  });
});
