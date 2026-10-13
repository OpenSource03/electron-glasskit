import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlassIslandOptions } from "../../../src/main/island.js";
import { setNative } from "../../../src/main/native.js";
import {
  type Alignment,
  type IslandEvent,
  type IslandEventType,
  type NodeValue,
  ui,
} from "../../../src/shared/nodes.js";
import type { Size } from "../../../src/shared/types.js";
import { decode } from "./helpers/native.js";
import { stage } from "./helpers/stage.js";

vi.mock("electron", () => import("./helpers/electron.js"));

afterEach(() => {
  setNative(undefined);
});

const FRAME = { x: 100, y: 200, width: 300, height: 100 };
const CONTENT = ui.text("Hello");
const WANTED = { width: 200, height: 40 };

function resize(size: Size): IslandEvent {
  return { type: "resize", size };
}

describe("GlassIsland creation", () => {
  it("sends the frame and content, and nothing else, when no option is given", () => {
    const { native, window, host } = stage();
    host.addIsland({ frame: FRAME, content: CONTENT });
    const [handle, options] = native.calls.islandCreate[0] ?? [];
    expect(handle).toBe(window.handle);
    expect(decode(options ?? "")).toStrictEqual({ frame: FRAME, content: { type: "text", text: "Hello" } });
  });

  it("sends every option that is given, except autoResize, which stays in JavaScript", () => {
    const { native, host } = stage();
    host.addIsland({
      frame: FRAME,
      content: CONTENT,
      fit: "both",
      autoResize: { anchor: "center" },
      passthrough: true,
      appearance: "dark",
      zIndex: 7,
      hidden: true,
    });
    expect(decode(native.calls.islandCreate[0]?.[1] ?? "")).toStrictEqual({
      frame: FRAME,
      content: { type: "text", text: "Hello" },
      fit: "both",
      passthrough: true,
      appearance: "dark",
      zIndex: 7,
      hidden: true,
    });
  });

  it("sends the content with its colours normalised", () => {
    const { native, host } = stage();
    host.addIsland({ frame: FRAME, content: ui.text("Hello", { foreground: "#f00" }) });
    expect(decode(native.calls.islandCreate[0]?.[1] ?? "")).toMatchObject({ content: { foreground: "#FF0000FF" } });
  });

  it("rejects invalid content without creating anything", () => {
    const { native, host } = stage();
    const content = ui.hstack({}, [ui.toggle({ id: "a" }), ui.toggle({ id: "a" })]);
    expect(() => host.addIsland({ frame: FRAME, content })).toThrow('Duplicate node id "a".');
    expect(native.calls.islandCreate).toHaveLength(0);
  });

  it("resolves a function frame against the window's content size", () => {
    const { host } = stage();
    const island = host.addIsland({
      frame: ({ width }) => ({ x: width - 100, y: 0, width: 100, height: 30 }),
      content: CONTENT,
    });
    expect(island.frame).toStrictEqual({ x: 700, y: 0, width: 100, height: 30 });
  });
});

describe("GlassIsland events", () => {
  it.each<IslandEvent>([
    { type: "press", node: "go" },
    { type: "change", node: "volume", value: 0.5 },
    { type: "change", node: "switch", value: false },
    { type: "change", node: "field", value: "" },
    { type: "submit", node: "field", value: "hello" },
    { type: "focus", node: "field" },
    { type: "blur", node: "field" },
    resize(WANTED),
  ])("delivers %j to listeners of its type as the event object", (event) => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const received: IslandEvent[] = [];
    island.on(event.type, (delivered) => received.push(delivered));
    native.emit(island.id, event);
    expect(received).toStrictEqual([event]);
  });

  it("lets a submit listener destructure node and value", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const received: string[] = [];
    island.on("submit", ({ node, value }) => received.push(`${node}=${value}`));
    native.emit(island.id, { type: "submit", node: "field", value: "hello" });
    expect(received).toStrictEqual(["field=hello"]);
  });

  it("lets a resize listener destructure the wanted size", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const received: Size[] = [];
    island.on("resize", ({ size }) => received.push(size));
    native.emit(island.id, resize(WANTED));
    expect(received).toStrictEqual([WANTED]);
  });

  it.each<[IslandEventType, IslandEvent]>([
    ["press", { type: "focus", node: "field" }],
    ["focus", { type: "blur", node: "field" }],
    ["blur", { type: "press", node: "go" }],
    ["change", { type: "submit", node: "field", value: "hello" }],
    ["submit", { type: "change", node: "field", value: "hello" }],
    ["resize", { type: "press", node: "go" }],
  ])("does not deliver to %s listeners an event of another type: %j", (type, event) => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const listener = vi.fn();
    island.on(type, listener);
    native.emit(island.id, event);
    expect(listener).not.toHaveBeenCalled();
  });

  it("delivers an event only to the island it belongs to", () => {
    const { native, host } = stage();
    const first = host.addIsland({ frame: FRAME, content: CONTENT });
    const second = host.addIsland({ frame: FRAME, content: CONTENT });
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    first.on("press", onFirst);
    second.on("press", onSecond);
    native.emit(second.id, { type: "press", node: "go" });
    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).toHaveBeenCalledExactlyOnceWith({ type: "press", node: "go" });
  });

  it("calls every listener of an event, in the order they subscribed", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const order: string[] = [];
    island.on("press", () => order.push("first"));
    island.on("press", () => order.push("second"));
    native.emit(island.id, { type: "press", node: "go" });
    expect(order).toStrictEqual(["first", "second"]);
  });

  it("calls a listener once per event even when it subscribed twice", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const listener = vi.fn();
    island.on("press", listener);
    island.on("press", listener);
    native.emit(island.id, { type: "press", node: "go" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns an unsubscribe function from on", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const listener = vi.fn();
    const unsubscribe = island.on("press", listener);
    unsubscribe();
    native.emit(island.id, { type: "press", node: "go" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("lets unsubscribe be called twice", () => {
    const { host } = stage();
    const unsubscribe = host.addIsland({ frame: FRAME, content: CONTENT }).on("press", vi.fn());
    unsubscribe();
    expect(unsubscribe).not.toThrow();
  });

  it("keeps the other listeners when one unsubscribes", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const kept = vi.fn();
    island.on("press", vi.fn())();
    island.on("press", kept);
    native.emit(island.id, { type: "press", node: "go" });
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("clears its listeners when it is removed", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    const listener = vi.fn();
    island.on("press", listener);
    island.on("resize", listener);
    island.remove();
    native.emit(island.id, { type: "press", node: "go" });
    native.emit(island.id, resize(WANTED));
    expect(listener).not.toHaveBeenCalled();
  });

  it("registers one event callback with the addon, however many islands there are", () => {
    const { native, host } = stage();
    host.addIsland({ frame: FRAME, content: CONTENT });
    host.addIsland({ frame: FRAME, content: CONTENT });
    expect(native.calls.setEventCallback).toHaveLength(1);
  });
});

describe("GlassIsland autoResize", () => {
  function fitted(options: Partial<GlassIslandOptions>, wanted: Size = WANTED): number[] | undefined {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, ...options });
    native.emit(island.id, resize(wanted));
    return native.framesOf(island.id).at(-1);
  }

  it("resizes to the wanted width with `fit: width`, anchored at the top-leading corner by default", () => {
    expect(fitted({ fit: "width" })).toStrictEqual([100, 200, 200, 100, 0]);
  });

  it("resizes to the wanted height with `fit: height`", () => {
    expect(fitted({ fit: "height" })).toStrictEqual([100, 200, 300, 40, 0]);
  });

  it("resizes to the wanted size with `fit: both`", () => {
    expect(fitted({ fit: "both" })).toStrictEqual([100, 200, 200, 40, 0]);
  });

  it("keeps the frame's size with `fit: none`", () => {
    expect(fitted({ fit: "none" })).toStrictEqual([100, 200, 300, 100, 0]);
  });

  it("keeps the frame's size when fit is not given", () => {
    expect(fitted({})).toStrictEqual([100, 200, 300, 100, 0]);
  });

  it("anchors at the top-leading corner with `autoResize: true`", () => {
    expect(fitted({ fit: "both", autoResize: true })).toStrictEqual([100, 200, 200, 40, 0]);
  });

  it("anchors at the top-leading corner when autoResize names no anchor", () => {
    expect(fitted({ fit: "both", autoResize: {} })).toStrictEqual([100, 200, 200, 40, 0]);
  });

  it.each<[Alignment, number, number]>([
    ["topLeading", 100, 200],
    ["top", 150, 200],
    ["topTrailing", 200, 200],
    ["leading", 100, 230],
    ["center", 150, 230],
    ["trailing", 200, 230],
    ["bottomLeading", 100, 260],
    ["bottom", 150, 260],
    ["bottomTrailing", 200, 260],
  ])("keeps the %s point in place", (anchor, x, y) => {
    expect(fitted({ fit: "both", autoResize: { anchor } })).toStrictEqual([x, y, 200, 40, 0]);
  });

  it("grows around the anchor when the content wants more room", () => {
    expect(fitted({ fit: "both", autoResize: { anchor: "bottom" } }, { width: 400, height: 150 })).toStrictEqual([
      50, 150, 400, 150, 0,
    ]);
  });

  it("never resizes with `autoResize: false`", () => {
    expect(fitted({ fit: "both", autoResize: false })).toStrictEqual([100, 200, 300, 100, 0]);
  });

  it("still reports the wanted size with `autoResize: false`", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both", autoResize: false });
    const listener = vi.fn();
    island.on("resize", listener);
    native.emit(island.id, resize(WANTED));
    expect(listener).toHaveBeenCalledExactlyOnceWith(resize(WANTED));
  });

  it("has applied the new size by the time resize listeners run", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    const seen: number[] = [];
    island.on("resize", () => seen.push(island.frame.width));
    native.emit(island.id, resize(WANTED));
    expect(seen).toStrictEqual([200]);
  });

  it("exposes the fitted frame as island.frame", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both", autoResize: { anchor: "center" } });
    native.emit(island.id, resize(WANTED));
    expect(island.frame).toStrictEqual({ x: 150, y: 230, width: 200, height: 40 });
  });

  it("follows the latest wanted size", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    native.emit(island.id, resize({ width: 250, height: 60 }));
    expect(island.frame).toStrictEqual({ x: 100, y: 200, width: 250, height: 60 });
  });

  it("always measures from the frame it was given, not from the last fitted frame", () => {
    const { native, host } = stage();
    const island = host.addIsland({
      frame: FRAME,
      content: CONTENT,
      fit: "both",
      autoResize: { anchor: "bottomTrailing" },
    });
    native.emit(island.id, resize(WANTED));
    native.emit(island.id, resize(WANTED));
    expect(island.frame).toStrictEqual({ x: 200, y: 260, width: 200, height: 40 });
  });

  it("keeps the wanted size when setFrame moves the island", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    island.setFrame({ x: 0, y: 0, width: 500, height: 500 });
    expect(island.frame).toStrictEqual({ x: 0, y: 0, width: 200, height: 40 });
  });

  it("keeps the wanted size when a function frame is re-applied on a window resize", () => {
    const { native, window, host } = stage();
    const island = host.addIsland({
      frame: ({ width }) => ({ x: width - 300, y: 0, width: 300, height: 100 }),
      content: CONTENT,
      fit: "both",
      autoResize: { anchor: "topTrailing" },
    });
    native.emit(island.id, resize(WANTED));
    window.resizeContent({ width: 1000, height: 600 });
    expect(island.frame).toStrictEqual({ x: 800, y: 0, width: 200, height: 40 });
  });

  it("ignores resize events after it is removed", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    island.remove();
    native.emit(island.id, resize(WANTED));
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });
});

describe("GlassIsland.update", () => {
  it("sends only the options that are given", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, zIndex: 3 });
    expect(island.update({ hidden: true })).toBe(island);
    expect(native.updatesOf(island.id)).toStrictEqual([{ hidden: true }]);
  });

  it("sends a changed fit to the addon but never autoResize or the frame", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.update({ fit: "width", autoResize: { anchor: "center" }, frame: FRAME });
    expect(native.updatesOf(island.id)).toStrictEqual([{ fit: "width" }]);
  });

  it("forgets the wanted size when fit changes, returning to the frame it was given", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    island.update({ fit: "width" });
    expect(island.frame).toStrictEqual(FRAME);
    expect(native.framesOf(island.id).at(-1)).toStrictEqual([100, 200, 300, 100, 0]);
  });

  it("uses the next wanted size after fit changes", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    island.update({ fit: "width" });
    native.emit(island.id, resize({ width: 250, height: 999 }));
    expect(island.frame).toStrictEqual({ x: 100, y: 200, width: 250, height: 100 });
  });

  it("keeps the wanted size when update repeats the current fit", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    island.update({ fit: "both" });
    expect(island.frame).toStrictEqual({ x: 100, y: 200, width: 200, height: 40 });
  });

  it("re-anchors the fitted frame when the anchor changes", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    island.update({ autoResize: { anchor: "bottomTrailing" } });
    expect(island.frame).toStrictEqual({ x: 200, y: 260, width: 200, height: 40 });
  });

  it("returns to the frame it was given when autoResize is turned off", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both" });
    native.emit(island.id, resize(WANTED));
    island.update({ autoResize: false });
    expect(island.frame).toStrictEqual(FRAME);
  });

  it("applies the last wanted size when autoResize is turned on", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT, fit: "both", autoResize: false });
    native.emit(island.id, resize(WANTED));
    island.update({ autoResize: true });
    expect(island.frame).toStrictEqual({ x: 100, y: 200, width: 200, height: 40 });
  });

  it("moves the island when a frame is given", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.update({ frame: { x: 1, y: 2, width: 3, height: 4 } });
    expect(native.framesOf(island.id)).toStrictEqual([[1, 2, 3, 4, 0]]);
  });

  it("does nothing after the island is removed", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.remove();
    expect(island.update({ hidden: true, frame: FRAME })).toBe(island);
    expect(native.calls.objectUpdate).toHaveLength(0);
    expect(native.calls.objectSetFrame).toHaveLength(0);
  });
});

describe("GlassIsland.setContent", () => {
  it("sends the prepared content and null when no animation is given", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    expect(island.setContent(ui.shape("circle", { fill: "#0f0" }))).toBe(island);
    const [id, content, animation] = native.calls.islandSetContent[0] ?? [];
    expect(id).toBe(island.id);
    expect(decode(content ?? "")).toStrictEqual({ type: "shape", shape: "circle", fill: "#00FF00FF" });
    expect(animation).toBeNull();
  });

  it("sends a named animation as JSON", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.setContent(CONTENT, { animation: "bouncy" });
    expect(native.calls.islandSetContent[0]?.[2]).toBe('"bouncy"');
  });

  it("sends a spring animation as JSON", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.setContent(CONTENT, { animation: { type: "spring", duration: 0.4, bounce: 0.3 } });
    expect(decode(native.calls.islandSetContent[0]?.[2] ?? "")).toStrictEqual({
      type: "spring",
      duration: 0.4,
      bounce: 0.3,
    });
  });

  it("rejects invalid content without calling the addon", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    expect(() => island.setContent(ui.button({ id: "", label: "Go" }))).toThrow('A "button" node needs an id.');
    expect(native.calls.islandSetContent).toHaveLength(0);
  });

  it("does nothing after the island is removed", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.remove();
    expect(island.setContent(CONTENT)).toBe(island);
    expect(native.calls.islandSetContent).toHaveLength(0);
  });
});

describe("GlassIsland.setValue and focus", () => {
  it.each<[NodeValue, string]>([
    ["hello", '"hello"'],
    ["", '""'],
    [0.5, "0.5"],
    [0, "0"],
    [true, "true"],
    [false, "false"],
  ])("sends the value %j as the JSON %s", (value, encoded) => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.setValue("control", value);
    expect(native.calls.islandSetValue).toStrictEqual([[island.id, "control", encoded]]);
  });

  it("returns true from setValue when the control exists", () => {
    const { host } = stage();
    expect(host.addIsland({ frame: FRAME, content: CONTENT }).setValue("control", 1)).toBe(true);
  });

  it("returns false from setValue when the island has no such control", () => {
    const { native, host } = stage();
    native.found = false;
    expect(host.addIsland({ frame: FRAME, content: CONTENT }).setValue("missing", 1)).toBe(false);
  });

  it("returns false from setValue after removal, without calling the addon", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.remove();
    expect(island.setValue("control", 1)).toBe(false);
    expect(native.calls.islandSetValue).toHaveLength(0);
  });

  it("asks the addon to focus the node", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    expect(island.focus("field")).toBe(true);
    expect(native.calls.islandFocus).toStrictEqual([[island.id, "field"]]);
  });

  it("returns false from focus when there is no such field", () => {
    const { native, host } = stage();
    native.found = false;
    expect(host.addIsland({ frame: FRAME, content: CONTENT }).focus("missing")).toBe(false);
  });

  it("returns false from focus after removal, without calling the addon", () => {
    const { native, host } = stage();
    const island = host.addIsland({ frame: FRAME, content: CONTENT });
    island.remove();
    expect(island.focus("field")).toBe(false);
    expect(native.calls.islandFocus).toHaveLength(0);
  });
});
