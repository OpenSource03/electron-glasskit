// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindIsland, type IslandBinding, type IslandBindingOptions, ui } from "../../../src/renderer/index.js";
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
let bound: IslandBinding[];

const content = ui.hstack({}, [ui.textField({ id: "message" }), ui.button({ id: "send", label: "Send" })]);

function island(element: HTMLElement, options: Partial<IslandBindingOptions> = {}): IslandBinding {
  const binding = bindIsland(element, { content, ...options });
  bound.push(binding);
  return binding;
}

function lastItem(): BoundItem {
  const item = bridge.commit.mock.lastCall?.[0].items[0];
  if (!item) throw new Error("nothing was committed");
  return item;
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

describe("content", () => {
  it("commits the island with its content and options", () => {
    island(createElement(), { fit: "height", zIndex: 4, tracking: "frame", applySize: false });
    page.frame();
    expect(lastItem()).toEqual({
      kind: "island",
      key: expect.stringMatching(/^island:/),
      rect: { x: 10, y: 20, width: 300, height: 40 },
      content,
      fit: "height",
      zIndex: 4,
      hidden: false,
    });
  });

  it("commits new content together with its animation", () => {
    const binding = island(createElement());
    page.frame();

    const next = ui.text("Sent");
    binding.update({ content: next, animation: "bouncy" });
    page.frame();

    expect(bridge.commit).toHaveBeenCalledTimes(2);
    expect(lastItem()).toMatchObject({ content: next, animation: "bouncy" });
  });

  it("does not commit content that is equal by value", () => {
    const binding = island(createElement());
    page.frame();
    binding.update({ content: structuredClone(content) });
    page.frame();
    expect(bridge.commit).toHaveBeenCalledTimes(1);
  });
});

describe("events", () => {
  it("delivers each event to the listeners of its type on its own island", () => {
    const binding = island(createElement());
    island(createElement());
    page.frame();
    const key = lastItem().key;
    const onPress = vi.fn();
    const onChange = vi.fn();
    binding.on("press", onPress);
    binding.on("change", onChange);

    bridge.emit({ key, event: { type: "press", node: "send" } });
    bridge.emit({ key, event: { type: "change", node: "message", value: "hi" } });
    bridge.emit({ key: "island:other", event: { type: "press", node: "send" } });

    expect(onPress.mock.calls).toEqual([[{ type: "press", node: "send" }]]);
    expect(onChange.mock.calls).toEqual([[{ type: "change", node: "message", value: "hi" }]]);
  });

  it("stops delivering after unsubscribing and after unbinding", () => {
    const binding = island(createElement());
    page.frame();
    const key = lastItem().key;
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = binding.on("press", first);
    binding.on("press", second);

    unsubscribe();
    bridge.emit({ key, event: { type: "press", node: "send" } });
    binding.unbind();
    bridge.emit({ key, event: { type: "press", node: "send" } });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("commands", () => {
  it("sends setValue and focus for the island's key", () => {
    const binding = island(createElement());
    page.frame();
    const key = lastItem().key;

    binding.setValue("message", "hello");
    binding.focus("message");

    expect(bridge.command.mock.calls).toEqual([
      [{ type: "setValue", key, node: "message", value: "hello" }],
      [{ type: "focus", key, node: "message" }],
    ]);
  });

  it("holds a command until the commit that creates the island has been sent", () => {
    const binding = island(createElement());
    binding.focus("message");
    expect(bridge.command).not.toHaveBeenCalled();

    page.frame();

    expect(bridge.command).toHaveBeenCalledTimes(1);
    expect(bridge.commit.mock.invocationCallOrder[0]).toBeLessThan(bridge.command.mock.invocationCallOrder[0] ?? 0);
  });

  it("ignores commands after unbinding", () => {
    const binding = island(createElement());
    page.frame();
    binding.unbind();
    binding.setValue("message", "late");
    page.frame();
    expect(bridge.command).not.toHaveBeenCalled();
  });
});

describe("fit", () => {
  const resize = (key: string, width: number, height: number): void =>
    bridge.emit({ key, event: { type: "resize", size: { width, height } } });

  it("shows an island that is collapsed only on the axis its content sizes", () => {
    const element = createElement({ x: 0, y: 0, width: 300, height: 0 });
    island(element, { fit: "height" });
    page.frame();
    expect(lastItem()).toMatchObject({ hidden: false });

    place(element, { x: 0, y: 0, width: 0, height: 0 });
    page.resize();
    page.frame();
    expect(lastItem()).toMatchObject({ hidden: true });
  });

  it.each([
    ["width", "120px", ""],
    ["height", "", "48px"],
    ["both", "120px", "48px"],
  ] as const)("applies the reported size on the fitted axes (%s)", (fit, width, height) => {
    const element = createElement();
    island(element, { fit });
    page.frame();

    resize(lastItem().key, 120, 48);

    expect(element.style.width).toBe(width);
    expect(element.style.height).toBe(height);
  });

  it("subtracts padding and borders unless the element is border-box", () => {
    const element = createElement();
    element.style.cssText = "padding: 0 10px; border: 2px solid black; box-sizing: content-box";
    const bordered = createElement();
    bordered.style.cssText = "padding: 0 10px; box-sizing: border-box";
    island(element, { fit: "width" });
    island(bordered, { fit: "width" });
    page.frame();

    for (const item of bridge.commit.mock.lastCall?.[0].items ?? []) resize(item.key, 120, 48);

    expect(element.style.width).toBe("96px");
    expect(bordered.style.width).toBe("120px");
  });

  it("writes a size only when it changes, so layout and resize cannot loop", () => {
    const element = createElement();
    island(element, { fit: "both" });
    page.frame();
    const key = lastItem().key;
    resize(key, 120, 48);

    // A write would overwrite this marker.
    element.style.width = "1px";
    resize(key, 120, 48);
    resize(key, 120.2, 48);
    expect(element.style.width).toBe("1px");

    resize(key, 140, 48);
    expect(element.style.width).toBe("140px");
  });

  it("leaves the element alone with applySize: false or no fit, but still reports the event", () => {
    const unfitted = createElement();
    const first = island(unfitted);
    const optedOut = createElement();
    island(optedOut, { fit: "both", applySize: false });
    page.frame();
    const onResize = vi.fn();
    first.on("resize", onResize);
    const [a, b] = bridge.commit.mock.lastCall?.[0].items ?? [];

    resize(a?.key ?? "", 120, 48);
    resize(b?.key ?? "", 120, 48);

    expect(unfitted.style.width).toBe("");
    expect(optedOut.style.width).toBe("");
    expect(onResize).toHaveBeenCalledWith({ type: "resize", size: { width: 120, height: 48 } });
  });

  it("restores the inline size on unbind and when the axis stops being fitted", () => {
    const element = createElement();
    element.style.width = "50%";
    const binding = island(element, { fit: "both" });
    page.frame();
    resize(lastItem().key, 120, 48);

    binding.update({ fit: "height" });
    expect(element.style.width).toBe("50%");
    expect(element.style.height).toBe("48px");

    binding.unbind();
    expect(element.style.height).toBe("");
  });
});
