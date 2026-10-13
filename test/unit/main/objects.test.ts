import { afterEach, describe, expect, it, vi } from "vitest";
import { setNative } from "../../../src/main/native.js";
import { decode } from "./helpers/native.js";
import { stage } from "./helpers/stage.js";

vi.mock("electron", () => import("./helpers/electron.js"));

afterEach(() => {
  setNative(undefined);
});

const FRAME = { x: 10, y: 20, width: 300, height: 100 };

describe("GlassRegion creation", () => {
  it("creates the region in the window, outside any group", () => {
    const { native, window, host } = stage();
    host.addRegion({ frame: FRAME });
    const [handle, groupId] = native.calls.regionCreate[0] ?? [];
    expect(handle).toBe(window.handle);
    expect(groupId).toBe(0);
  });

  it("sends only the frame when no other option is given", () => {
    const { native, host } = stage();
    host.addRegion({ frame: FRAME });
    expect(decode(native.calls.regionCreate[0]?.[2] ?? "")).toStrictEqual({ frame: FRAME });
  });

  it("sends every option that is given", () => {
    const { native, host } = stage();
    host.addRegion({
      frame: FRAME,
      cornerRadius: 16,
      interactive: true,
      passthrough: false,
      zIndex: 2,
      hidden: true,
      style: "clear",
      tint: "#ff000080",
      appearance: "dark",
      unstable_variant: 2,
      unstable_scrim: true,
      unstable_subdued: false,
    });
    expect(decode(native.calls.regionCreate[0]?.[2] ?? "")).toStrictEqual({
      frame: FRAME,
      cornerRadius: 16,
      interactive: true,
      passthrough: false,
      zIndex: 2,
      hidden: true,
      style: "clear",
      tint: "#FF000080",
      appearance: "dark",
      unstable_variant: 2,
      unstable_scrim: true,
      unstable_subdued: false,
    });
  });

  it("normalises the tint", () => {
    const { native, host } = stage();
    host.addRegion({ frame: FRAME, tint: "#0af" });
    expect(decode(native.calls.regionCreate[0]?.[2] ?? "")).toStrictEqual({ frame: FRAME, tint: "#00AAFFFF" });
  });

  it("sends `tint: null` as null", () => {
    const { native, host } = stage();
    host.addRegion({ frame: FRAME, tint: null });
    expect(decode(native.calls.regionCreate[0]?.[2] ?? "")).toStrictEqual({ frame: FRAME, tint: null });
  });

  it("rejects an invalid tint without creating anything", () => {
    const { native, host } = stage();
    expect(() => host.addRegion({ frame: FRAME, tint: "red" })).toThrow('Invalid colour "red".');
    expect(native.calls.regionCreate).toHaveLength(0);
  });

  it("rejects an invalid frame without creating anything", () => {
    const { native, host } = stage();
    expect(() => host.addRegion({ frame: { ...FRAME, width: Number.NaN } })).toThrow('Invalid frame: "width"');
    expect(native.calls.regionCreate).toHaveLength(0);
  });

  it("resolves a function frame against the window's content size", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: ({ width, height }) => ({ x: 0, y: height - 40, width, height: 40 }) });
    expect(region.frame).toStrictEqual({ x: 0, y: 560, width: 800, height: 40 });
    expect(decode(native.calls.regionCreate[0]?.[2] ?? "")).toStrictEqual({
      frame: { x: 0, y: 560, width: 800, height: 40 },
    });
  });

  it("clamps a negative size to zero", () => {
    const { host } = stage();
    expect(host.addRegion({ frame: { x: 5, y: 5, width: -10, height: -10 } }).frame).toStrictEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });

  it("exposes the id the addon returned", () => {
    const { native, host } = stage();
    const first = host.addRegion({ frame: FRAME });
    const second = host.addRegion({ frame: FRAME });
    expect([first.id, second.id]).toStrictEqual([native.lastId - 1, native.lastId]);
  });

  it("hands out a copy of its frame", () => {
    const { host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.frame.x = 999;
    expect(region.frame).toStrictEqual(FRAME);
  });
});

describe("GlassRegion.update", () => {
  it("sends only the options that are given", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME, cornerRadius: 8, tint: "#fff" });
    region.update({ zIndex: 4 });
    expect(native.updatesOf(region.id)).toStrictEqual([{ zIndex: 4 }]);
  });

  it("normalises the tint", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.update({ tint: "#abc" });
    expect(native.updatesOf(region.id)).toStrictEqual([{ tint: "#AABBCCFF" }]);
  });

  it("sends `tint: null` as null, so a tint can be removed", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME, tint: "#fff" });
    region.update({ tint: null });
    expect(native.updatesOf(region.id)).toStrictEqual([{ tint: null }]);
  });

  it("leaves the frame out of the update and does not move the region", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.update({ hidden: true });
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });

  it("moves the region when a frame is given", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.update({ hidden: false, frame: { x: 1, y: 2, width: 3, height: 4 } });
    expect(native.updatesOf(region.id)).toStrictEqual([{ hidden: false }]);
    expect(native.framesOf(region.id)).toStrictEqual([[1, 2, 3, 4, 0]]);
  });

  it("returns the region, for chaining", () => {
    const { host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(region.update({ zIndex: 1 })).toBe(region);
  });

  it("rejects an invalid tint without calling the addon", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(() => region.update({ tint: "blue" })).toThrow(TypeError);
    expect(native.calls.objectUpdate).toHaveLength(0);
  });
});

describe("setFrame", () => {
  it("applies a rectangle immediately, without animation", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.setFrame({ x: 1, y: 2, width: 3, height: 4 });
    expect(native.framesOf(region.id)).toStrictEqual([[1, 2, 3, 4, 0]]);
    expect(region.frame).toStrictEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("animates for a quarter of a second with `animate: true`", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.setFrame(FRAME, { animate: true });
    expect(native.framesOf(region.id)[0]?.[4]).toBe(0.25);
  });

  it("animates for the given number of seconds", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.setFrame(FRAME, { animate: 1.5 });
    expect(native.framesOf(region.id)[0]?.[4]).toBe(1.5);
  });

  it("does not animate with `animate: false`", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.setFrame(FRAME, { animate: false });
    expect(native.framesOf(region.id)[0]?.[4]).toBe(0);
  });

  it("resolves a function frame against the current content size", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    window.content = { x: 0, y: 0, width: 400, height: 300 };
    region.setFrame(({ width, height }) => ({ x: 0, y: 0, width: width / 2, height: height / 2 }));
    expect(native.framesOf(region.id)).toStrictEqual([[0, 0, 200, 150, 0]]);
  });

  it("clamps a negative size to zero", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.setFrame({ x: 0, y: 0, width: -1, height: -1 });
    expect(native.framesOf(region.id)).toStrictEqual([[0, 0, 0, 0, 0]]);
  });

  it("returns the object, for chaining", () => {
    const { host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(region.setFrame(FRAME)).toBe(region);
  });

  it("rejects an invalid frame without calling the addon", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(() => region.setFrame({ ...FRAME, y: Number.POSITIVE_INFINITY })).toThrow('Invalid frame: "y"');
    expect(native.calls.objectSetFrame).toHaveLength(0);
    expect(region.frame).toStrictEqual(FRAME);
  });

  it("keeps following the previous function frame after a rejected setFrame", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    expect(() => region.setFrame(() => ({ x: Number.NaN, y: 0, width: 1, height: 1 }))).toThrow(TypeError);
    window.resizeContent({ width: 500, height: 600 });
    expect(native.framesOf(region.id)).toStrictEqual([[0, 0, 500, 40, 0]]);
  });
});

describe("a rejected setFrame", () => {
  it("leaves a fixed frame in charge", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: { type: "text", text: "Hi" } });
    expect(() => island.setFrame({ ...FRAME, x: Number.NaN })).toThrow(TypeError);
    island.update({ hidden: true });
    expect(native.framesOf(island.id)).toStrictEqual([[10, 20, 300, 100, 0]]);
  });

  it("does not start following a function whose first result is invalid", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(() => region.setFrame(() => ({ x: 0, y: 0, width: Number.NaN, height: 1 }))).toThrow(TypeError);
    expect(() => window.resizeContent({ width: 500, height: 600 })).not.toThrow();
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });

  it("is also what update does with an invalid frame, after sending the other options", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(() => region.update({ zIndex: 2, frame: { ...FRAME, height: Number.NaN } })).toThrow(TypeError);
    expect(native.updatesOf(region.id)).toStrictEqual([{ zIndex: 2 }]);
    expect(region.frame).toStrictEqual(FRAME);
  });
});

describe("function frames and window resizes", () => {
  it("re-applies a function frame when the window resizes", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: ({ width, height }) => ({ x: 0, y: height - 40, width, height: 40 }) });
    window.resizeContent({ width: 1000, height: 700 });
    expect(native.framesOf(region.id)).toStrictEqual([[0, 660, 1000, 40, 0]]);
    expect(region.frame).toStrictEqual({ x: 0, y: 660, width: 1000, height: 40 });
  });

  it("re-applies it on every resize", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    window.resizeContent({ width: 900, height: 600 });
    window.resizeContent({ width: 700, height: 600 });
    expect(native.framesOf(region.id).map(([, , width]) => width)).toStrictEqual([900, 700]);
  });

  it("does not touch a fixed frame when the window resizes", () => {
    const { native, window, host } = stage();
    host.addRegion({ frame: FRAME });
    window.resizeContent({ width: 1000, height: 700 });
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });

  it("starts following once setFrame is given a function", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.setFrame(({ width }) => ({ x: 0, y: 0, width, height: 40 }));
    window.resizeContent({ width: 500, height: 600 });
    expect(native.framesOf(region.id)).toStrictEqual([
      [0, 0, 800, 40, 0],
      [0, 0, 500, 40, 0],
    ]);
  });

  it("stops following once setFrame is given a rectangle", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    region.setFrame(FRAME);
    window.resizeContent({ width: 500, height: 600 });
    expect(native.framesOf(region.id)).toStrictEqual([[10, 20, 300, 100, 0]]);
  });

  it("follows only the latest function after setFrame replaces one function with another", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    region.setFrame(({ height }) => ({ x: 0, y: 0, width: 40, height }));
    window.resizeContent({ width: 500, height: 300 });
    expect(native.framesOf(region.id)).toStrictEqual([
      [0, 0, 40, 600, 0],
      [0, 0, 40, 300, 0],
    ]);
  });

  it("stops following once the region is removed", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    region.remove();
    window.resizeContent({ width: 500, height: 600 });
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });

  it("follows a function frame given through update", () => {
    const { native, window, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.update({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    window.resizeContent({ width: 640, height: 600 });
    expect(native.framesOf(region.id).at(-1)).toStrictEqual([0, 0, 640, 40, 0]);
  });

  it("re-applies the function frames of regions inside a group", () => {
    const { native, window, host } = stage();
    const region = host.addGroup().addRegion({ frame: ({ width }) => ({ x: 0, y: 0, width, height: 40 }) });
    window.resizeContent({ width: 640, height: 600 });
    expect(native.framesOf(region.id)).toStrictEqual([[0, 0, 640, 40, 0]]);
  });
});

describe("remove", () => {
  it("removes the native object once", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.remove();
    region.remove();
    expect(native.removed()).toStrictEqual([region.id]);
  });

  it("reports the object as removed", () => {
    const { host } = stage();
    const region = host.addRegion({ frame: FRAME });
    expect(region.isRemoved).toBe(false);
    region.remove();
    expect(region.isRemoved).toBe(true);
  });

  it("turns update into a no-op", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.remove();
    expect(region.update({ zIndex: 3, frame: FRAME })).toBe(region);
    expect(native.calls.objectUpdate).toHaveLength(0);
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });

  it("turns setFrame into a no-op that keeps the last frame", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.remove();
    expect(region.setFrame({ x: 0, y: 0, width: 1, height: 1 })).toBe(region);
    expect(native.calls.objectSetFrame).toHaveLength(0);
    expect(region.frame).toStrictEqual(FRAME);
  });

  it("is not repeated when the host is disposed afterwards", () => {
    const { native, host } = stage();
    const region = host.addRegion({ frame: FRAME });
    region.remove();
    host.dispose();
    expect(native.removed()).toStrictEqual([region.id]);
  });
});

describe("GlassGroup", () => {
  it("sends nothing but an empty object when no option is given", () => {
    const { native, window, host } = stage();
    host.addGroup();
    expect(native.calls.groupCreate[0]?.[0]).toBe(window.handle);
    expect(decode(native.calls.groupCreate[0]?.[1] ?? "")).toStrictEqual({});
  });

  it("sends spacing and zIndex", () => {
    const { native, host } = stage();
    host.addGroup({ spacing: 24, zIndex: 3 });
    expect(decode(native.calls.groupCreate[0]?.[1] ?? "")).toStrictEqual({ spacing: 24, zIndex: 3 });
  });

  it("creates its regions inside the native group", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    group.addRegion({ frame: FRAME, cornerRadius: 9 });
    const [, groupId, options] = native.calls.regionCreate[0] ?? [];
    expect(groupId).toBe(group.id);
    expect(decode(options ?? "")).toStrictEqual({ frame: FRAME, cornerRadius: 9 });
  });

  it("updates only the options that are given", () => {
    const { native, host } = stage();
    const group = host.addGroup({ spacing: 24 });
    expect(group.update({ zIndex: 5 })).toBe(group);
    expect(native.updatesOf(group.id)).toStrictEqual([{ zIndex: 5 }]);
  });

  it("marks its regions removed when it is removed", () => {
    const { host } = stage();
    const group = host.addGroup();
    const regions = [group.addRegion({ frame: FRAME }), group.addRegion({ frame: FRAME })];
    group.remove();
    expect(regions.map((region) => region.isRemoved)).toStrictEqual([true, true]);
  });

  it("removes the native group before its regions", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    const region = group.addRegion({ frame: FRAME });
    group.remove();
    expect(native.removed()).toStrictEqual([group.id, region.id]);
  });

  it("leaves the group in place when one of its regions is removed", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    const region = group.addRegion({ frame: FRAME });
    region.remove();
    expect(group.isRemoved).toBe(false);
    expect(native.removed()).toStrictEqual([region.id]);
  });

  it("does not remove a region twice when the region went first", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    const region = group.addRegion({ frame: FRAME });
    region.remove();
    group.remove();
    expect(native.removed()).toStrictEqual([region.id, group.id]);
  });

  it("still removes the regions that are left after one went on its own", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    const [first, second] = [group.addRegion({ frame: FRAME }), group.addRegion({ frame: FRAME })];
    first.remove();
    group.remove();
    expect(native.removed()).toStrictEqual([first.id, group.id, second.id]);
  });

  it("removes its regions when the host is disposed, each exactly once", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    const region = group.addRegion({ frame: FRAME });
    host.dispose();
    expect(native.removed().sort()).toStrictEqual([group.id, region.id]);
  });

  it("throws from addRegion after it is removed", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    group.remove();
    expect(() => group.addRegion({ frame: FRAME })).toThrow("This glass group has been removed.");
    expect(native.calls.regionCreate).toHaveLength(0);
  });

  it("turns update into a no-op after it is removed", () => {
    const { native, host } = stage();
    const group = host.addGroup();
    group.remove();
    expect(group.update({ spacing: 4 })).toBe(group);
    expect(native.calls.objectUpdate).toHaveLength(0);
  });
});

describe("GlassBackground", () => {
  it("sets the background on the window with no options by default", () => {
    const { native, window, host } = stage();
    host.setBackground();
    expect(native.calls.backgroundSet[0]?.[0]).toBe(window.handle);
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({});
  });

  it("sends every option that is given, with the tint normalised", () => {
    const { native, host } = stage();
    host.setBackground({
      cornerRadius: 10,
      opaque: true,
      fallbackMaterial: "sidebar",
      style: "clear",
      tint: "#123",
      appearance: "light",
      unstable_variant: 16,
      unstable_scrim: false,
      unstable_subdued: true,
    });
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({
      cornerRadius: 10,
      opaque: true,
      fallbackMaterial: "sidebar",
      style: "clear",
      tint: "#112233FF",
      appearance: "light",
      unstable_variant: 16,
      unstable_scrim: false,
      unstable_subdued: true,
    });
  });

  it("sends `fallbackMaterial: null` and `tint: null` as null", () => {
    const { native, host } = stage();
    host.setBackground({ fallbackMaterial: null, tint: null });
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({ fallbackMaterial: null, tint: null });
  });

  it("returns the same object when setBackground is called twice", () => {
    const { native, host } = stage();
    const first = host.setBackground({ tint: "#fff" });
    const second = host.setBackground({ opaque: true });
    expect(second).toBe(first);
    expect(native.calls.backgroundSet).toHaveLength(1);
  });

  it("updates the existing sheet on the second setBackground", () => {
    const { native, host } = stage();
    const background = host.setBackground({ tint: "#fff" });
    host.setBackground({ opaque: true, tint: "#000" });
    expect(native.updatesOf(background.id)).toStrictEqual([{ opaque: true, tint: "#000000FF" }]);
  });

  it("updates only the options that are given", () => {
    const { native, host } = stage();
    const background = host.setBackground();
    expect(background.update({ style: "clear" })).toBe(background);
    expect(native.updatesOf(background.id)).toStrictEqual([{ style: "clear" }]);
  });

  it("is exposed as host.background", () => {
    const { host } = stage();
    expect(host.background).toBeNull();
    const background = host.setBackground();
    expect(host.background).toBe(background);
  });

  it("is removed by clearBackground", () => {
    const { native, host } = stage();
    const background = host.setBackground();
    host.clearBackground();
    expect(background.isRemoved).toBe(true);
    expect(native.removed()).toStrictEqual([background.id]);
    expect(host.background).toBeNull();
  });

  it("does nothing in clearBackground when there is no background", () => {
    const { native, host } = stage();
    host.clearBackground();
    expect(native.log).not.toContain("objectRemove");
  });

  it("creates a new sheet when setBackground follows clearBackground", () => {
    const { native, host } = stage();
    const first = host.setBackground();
    host.clearBackground();
    const second = host.setBackground();
    expect(second).not.toBe(first);
    expect(native.calls.backgroundSet).toHaveLength(2);
  });

  it("creates a new sheet when the previous one was removed directly", () => {
    const { host } = stage();
    const first = host.setBackground();
    first.remove();
    expect(host.background).toBeNull();
    expect(host.setBackground()).not.toBe(first);
  });

  it("turns update into a no-op after it is removed", () => {
    const { native, host } = stage();
    const background = host.setBackground();
    background.remove();
    background.update({ opaque: true });
    expect(native.calls.objectUpdate).toHaveLength(0);
  });
});
