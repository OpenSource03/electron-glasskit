// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindIsland, bindRegion, createGroup, refresh, ui } from "../../../src/renderer/index.js";
import type { BoundItem } from "../../../src/shared/protocol.js";
import {
  createElement,
  type FakeBridge,
  installBridge,
  installPage,
  type Page,
  place,
  removeBridge,
} from "./harness.js";

let bridge: FakeBridge;
let page: Page;
let bound: Array<{ unbind(): void }>;

function region(element: HTMLElement, options?: Parameters<typeof bindRegion>[1]): ReturnType<typeof bindRegion> {
  const binding = bindRegion(element, options);
  bound.push(binding);
  return binding;
}

function lastItems(): BoundItem[] {
  const message = bridge.commit.mock.lastCall?.[0];
  if (!message) throw new Error("nothing was committed");
  return message.items;
}

beforeEach(() => {
  bridge = installBridge();
  page = installPage();
  bound = [];
});

afterEach(() => {
  for (const binding of bound) binding.unbind();
  page.frame();
  removeBridge();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("commits", () => {
  it("coalesces every bind and update of a frame into one commit", () => {
    const first = region(createElement(), { cornerRadius: 12 });
    region(createElement({ x: 0, y: 100, width: 50, height: 50 }), { tint: "#ff0000" });
    first.update({ cornerRadius: 16 });
    expect(bridge.commit).not.toHaveBeenCalled();

    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(1);
    expect(bridge.frames).not.toHaveBeenCalled();
    expect(lastItems()).toEqual([
      {
        kind: "region",
        key: expect.any(String),
        rect: { x: 10, y: 20, width: 300, height: 40 },
        options: { cornerRadius: 16, hidden: false },
      },
      {
        kind: "region",
        key: expect.any(String),
        rect: { x: 0, y: 100, width: 50, height: 50 },
        options: { tint: "#ff0000", hidden: false },
      },
    ]);
  });

  it("keeps renderer-only options out of the message", () => {
    region(createElement(), { tracking: "auto", fallback: { opacity: "0.5" }, zIndex: 2 });
    page.frame();
    expect(lastItems()).toEqual([expect.objectContaining({ options: { zIndex: 2, hidden: false } })]);
  });

  it("does not commit again when an update changes nothing", () => {
    const binding = region(createElement(), { cornerRadius: 12, tint: "#fff" });
    page.frame();

    binding.update({ cornerRadius: 12 });
    binding.update({ tint: "#fff" });
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(1);
    expect(bridge.frames).not.toHaveBeenCalled();
  });

  it("commits when an option changes", () => {
    const binding = region(createElement(), { cornerRadius: 12 });
    page.frame();

    binding.update({ tint: "#00ff00" });
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(lastItems()[0]).toMatchObject({ options: { cornerRadius: 12, tint: "#00ff00" } });
  });

  it("uses the same key when an element is bound again", () => {
    const element = createElement();
    const first = bindRegion(element);
    page.frame();
    const key = lastItems()[0]?.key;

    first.unbind();
    region(element);
    page.frame();

    // Unbinding and rebinding inside one frame leaves the committed set as it was.
    expect(bridge.commit).toHaveBeenCalledTimes(1);
    expect(key).toMatch(/^region:/);
  });
});

describe("frames", () => {
  it("sends only the rects that changed, once per frame", () => {
    const moving = createElement();
    region(moving);
    region(createElement({ x: 0, y: 200, width: 20, height: 20 }));
    page.frame();
    const key = lastItems()[0]?.key;

    place(moving, { x: 10, y: 5, width: 300, height: 40 });
    document.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(page.pendingFrames()).toBe(1);
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(1);
    expect(bridge.frames.mock.calls).toEqual([[[[key, 10, 5, 300, 40]]]]);
  });

  it("sends nothing when a scroll moves nothing", () => {
    region(createElement());
    page.frame();
    document.dispatchEvent(new Event("scroll"));
    page.frame();
    expect(bridge.frames).not.toHaveBeenCalled();
  });

  it("hears scrolling inside nested scrollers", () => {
    const scroller = createElement();
    const child = document.createElement("div");
    scroller.append(child);
    place(child, { x: 0, y: 0, width: 10, height: 10 });
    region(child);
    page.frame();

    place(child, { x: 0, y: -30, width: 10, height: 10 });
    scroller.dispatchEvent(new Event("scroll"));
    page.frame();

    expect(bridge.frames).toHaveBeenCalledTimes(1);
  });

  it("measures again when an observed element resizes and on refresh()", () => {
    const element = createElement();
    region(element);
    page.frame();
    expect(page.observed()).toEqual([element]);

    place(element, { x: 10, y: 20, width: 320, height: 40 });
    page.resize();
    page.frame();
    place(element, { x: 10, y: 60, width: 320, height: 40 });
    refresh();
    page.frame();

    expect(bridge.frames).toHaveBeenCalledTimes(2);
  });

  it("measures every frame with frame tracking and stops when it is turned off", () => {
    const element = createElement();
    const binding = region(element, { tracking: "frame" });
    page.frame();

    place(element, { x: 11, y: 20, width: 300, height: 40 });
    page.frame();
    place(element, { x: 12, y: 20, width: 300, height: 40 });
    page.frame();
    expect(bridge.frames).toHaveBeenCalledTimes(2);
    expect(page.pendingFrames()).toBe(1);

    binding.update({ tracking: "auto" });
    page.frame();
    expect(page.pendingFrames()).toBe(0);
    expect(bridge.commit).toHaveBeenCalledTimes(1);
  });

  it("leaves auto-tracked elements alone on frames that only serve frame tracking", () => {
    const still = createElement();
    const measureStill = vi.spyOn(still, "getBoundingClientRect");
    region(still);
    region(createElement(), { tracking: "frame" });
    page.frame();
    measureStill.mockClear();

    page.frame();

    expect(measureStill).not.toHaveBeenCalled();
  });
});

describe("hidden elements", () => {
  it.each([
    ["zero-sized", (element: HTMLElement) => place(element, { x: 0, y: 0, width: 0, height: 0 })],
    ["display: none", (element: HTMLElement) => place(element, { x: 0, y: 0, width: 0, height: 0 }, 0)],
    ["disconnected", (element: HTMLElement) => element.remove()],
  ])("commits a %s element as hidden instead of removing it", (_name, hide) => {
    const element = createElement();
    region(element);
    page.frame();

    hide(element);
    page.resize();
    page.frame();

    expect(lastItems()).toEqual([
      expect.objectContaining({ rect: { x: 10, y: 20, width: 300, height: 40 }, options: { hidden: true } }),
    ]);
    expect(bridge.frames).not.toHaveBeenCalled();
  });

  it("shows the item again, at its new place, when the element returns", () => {
    const element = createElement();
    region(element);
    page.frame();
    place(element, { x: 0, y: 0, width: 0, height: 0 });
    page.resize();
    page.frame();

    place(element, { x: 5, y: 6, width: 70, height: 80 });
    page.resize();
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(3);
    expect(lastItems()).toEqual([
      expect.objectContaining({ rect: { x: 5, y: 6, width: 70, height: 80 }, options: { hidden: false } }),
    ]);
  });

  it("keeps an element hidden while its own hidden option is set", () => {
    region(createElement(), { hidden: true });
    page.frame();
    expect(lastItems()[0]).toMatchObject({ options: { hidden: true } });
  });
});

describe("groups", () => {
  it("commits the group of its member regions", () => {
    const group = createGroup({ spacing: 12 });
    region(createElement(), { group });
    region(createElement(), { group });
    region(createElement());
    page.frame();

    const message = bridge.commit.mock.lastCall?.[0];
    expect(message?.groups).toEqual({ [group.key]: { spacing: 12 } });
    expect(message?.items.map((item) => (item.kind === "region" ? item.group : null))).toEqual([
      group.key,
      group.key,
      undefined,
    ]);
  });

  it("commits group option changes and ignores identical ones", () => {
    const group = createGroup({ spacing: 12 });
    region(createElement(), { group });
    page.frame();

    group.update({ spacing: 12 });
    page.frame();
    expect(bridge.commit).toHaveBeenCalledTimes(1);

    group.update({ zIndex: 3 });
    page.frame();
    expect(bridge.commit.mock.lastCall?.[0].groups).toEqual({ [group.key]: { spacing: 12, zIndex: 3 } });
  });

  it("moves a region between groups and out of them", () => {
    const first = createGroup();
    const second = createGroup();
    const binding = region(createElement(), { group: first });
    page.frame();

    binding.update({ group: second });
    page.frame();
    expect(Object.keys(bridge.commit.mock.lastCall?.[0].groups ?? {})).toEqual([second.key]);

    binding.update({ group: null });
    page.frame();
    expect(bridge.commit.mock.lastCall?.[0]).toMatchObject({ groups: {} });
    expect(lastItems()[0]).not.toHaveProperty("group");
  });

  it("ungroups the regions of a removed group", () => {
    const group = createGroup({ spacing: 4 });
    region(createElement(), { group });
    page.frame();

    group.remove();
    group.update({ spacing: 8 });
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(bridge.commit.mock.lastCall?.[0].groups).toEqual({});
    expect(lastItems()[0]).not.toHaveProperty("group");
  });

  it("does no work for a group without bound regions", () => {
    createGroup().update({ spacing: 2 });
    expect(page.pendingFrames()).toBe(0);
  });
});

describe("cleanup", () => {
  it("commits the removal and keeps the other items", () => {
    const gone = bindRegion(createElement());
    region(createElement());
    page.frame();

    gone.unbind();
    gone.unbind();
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(lastItems()).toHaveLength(1);
  });

  it("stops every listener, observer and frame once nothing is bound", () => {
    const addToDocument = vi.spyOn(document, "addEventListener");
    const removeFromDocument = vi.spyOn(document, "removeEventListener");
    const removeFromWindow = vi.spyOn(window, "removeEventListener");

    const first = bindRegion(createElement(), { tracking: "frame" });
    const second = bindRegion(createElement());
    page.frame();
    expect(addToDocument).toHaveBeenCalledExactlyOnceWith("scroll", expect.any(Function), {
      capture: true,
      passive: true,
    });
    expect(bridge.listenerCount()).toBe(2);

    first.unbind();
    second.unbind();

    expect(removeFromDocument).toHaveBeenCalledWith("scroll", addToDocument.mock.calls[0]?.[1], { capture: true });
    expect(removeFromWindow).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(page.observed()).toEqual([]);
    expect(bridge.listenerCount()).toBe(0);

    page.frame();
    expect(bridge.commit.mock.lastCall?.[0]).toEqual({ items: [], groups: {} });
    expect(page.pendingFrames()).toBe(0);

    document.dispatchEvent(new Event("scroll"));
    page.resize();
    refresh();
    expect(page.pendingFrames()).toBe(0);
  });

  it("starts again after everything was unbound", () => {
    bindRegion(createElement()).unbind();
    page.frame();
    region(createElement());
    page.frame();
    expect(lastItems()).toHaveLength(1);
    expect(bridge.listenerCount()).toBe(2);
  });

  it("keeps observing an element while another binding still uses it", () => {
    const element = createElement();
    const first = bindRegion(element);
    bound.push(bindIsland(element, { content: ui.text("Hello") }));
    page.frame();

    first.unbind();
    page.frame();
    expect(page.observed()).toEqual([element]);

    place(element, { x: 10, y: 20, width: 320, height: 40 });
    page.resize();
    page.frame();
    expect(bridge.frames).toHaveBeenCalledTimes(1);
  });
});

describe("resync", () => {
  it("commits everything again, unchanged, when the main process asks", () => {
    region(createElement(), { cornerRadius: 12 });
    page.frame();

    bridge.resync();
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(bridge.commit.mock.calls[1]).toEqual(bridge.commit.mock.calls[0]);
    expect(bridge.frames).not.toHaveBeenCalled();
  });
});

describe("failing sends", () => {
  it("retries a commit that threw and keeps the scheduler running", () => {
    const binding = region(createElement(), { cornerRadius: 12 });
    bridge.commit.mockImplementationOnce(() => {
      throw new Error("An object could not be cloned");
    });
    expect(() => page.frame()).toThrow("could not be cloned");
    expect(page.pendingFrames()).toBe(0);

    // Nothing was recorded as committed, so the same options go out with the next change.
    binding.update({ cornerRadius: 12 });
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(lastItems()).toHaveLength(1);
  });
});

describe("hidden windows", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("commits from a timer, because animation frames do not run", () => {
    region(createElement());
    expect(page.pendingFrames()).toBe(0);

    vi.runAllTimers();

    expect(bridge.commit).toHaveBeenCalledTimes(1);
  });

  it("is not held up by the per-frame loop of frame tracking", () => {
    const binding = region(createElement(), { tracking: "frame" });
    vi.runAllTimers();
    // The loop is armed on an animation frame that a hidden window never delivers.
    expect(page.pendingFrames()).toBe(1);

    binding.update({ tint: "#ff0000" });
    vi.runAllTimers();
    expect(bridge.commit).toHaveBeenCalledTimes(2);

    binding.unbind();
    vi.runAllTimers();
    expect(bridge.commit).toHaveBeenCalledTimes(3);
    expect(lastItems()).toEqual([]);
    expect(page.pendingFrames()).toBe(1);
  });
});

describe("page zoom", () => {
  afterEach(() => {
    window.devicePixelRatio = 1;
  });

  it("sends every visible rect again when the device pixel ratio changes", () => {
    const shown = createElement();
    region(shown);
    region(createElement({ x: 0, y: 0, width: 0, height: 0 }));
    page.frame();
    const key = lastItems()[0]?.key;

    window.devicePixelRatio = 2;
    window.dispatchEvent(new Event("resize"));
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(1);
    expect(bridge.frames.mock.calls).toEqual([[[[key, 10, 20, 300, 40]]]]);
  });
});
