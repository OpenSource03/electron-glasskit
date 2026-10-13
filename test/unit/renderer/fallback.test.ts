// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindIsland,
  bindRegion,
  defaultFallbackStyle,
  getCapabilities,
  isAvailable,
  refresh,
  ui,
} from "../../../src/renderer/index.js";
import {
  createElement,
  installBridge,
  installPage,
  MAC,
  type Page,
  removeBridge,
  settle,
  UNSUPPORTED,
} from "./harness.js";

let page: Page;

beforeEach(() => {
  page = installPage();
});

afterEach(() => {
  page.frame();
  removeBridge();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("without a bridge", () => {
  it("reports that glass is unavailable and never rejects", async () => {
    expect(isAvailable()).toBe(false);
    await expect(getCapabilities()).resolves.toEqual({
      platform: "unknown",
      osVersion: null,
      glass: false,
      fallback: false,
      interactiveRegions: false,
      islands: false,
    });
  });

  it("styles the element at once and schedules no work", () => {
    const element = createElement();
    const binding = bindRegion(element);

    expect(element.style.backdropFilter).toBe(defaultFallbackStyle.backdropFilter);
    expect(element.style.boxShadow).not.toBe("");
    binding.update({ tint: "#ff0000" });
    refresh();
    expect(page.pendingFrames()).toBe(0);

    binding.unbind();
    expect(element.getAttribute("style") ?? "").toBe("");
  });

  it("restores the inline styles that were there", () => {
    const element = createElement();
    element.style.cssText = "color: red; opacity: 0.9 !important";
    const binding = bindRegion(element, { fallback: { opacity: "0.5", backdropFilter: "blur(4px)" } });
    expect(element.style.opacity).toBe("0.5");
    expect(element.style.backdropFilter).toBe("blur(4px)");

    binding.unbind();

    expect(element.style.cssText).toBe("color: red; opacity: 0.9 !important;");
  });

  it("leaves the element alone with fallback: false", () => {
    const element = createElement();
    const binding = bindRegion(element, { fallback: false });
    expect(element.getAttribute("style") ?? "").toBe("");

    binding.update({ fallback: true });
    expect(element.style.backdropFilter).toBe(defaultFallbackStyle.backdropFilter);
    binding.update({ fallback: false });
    expect(element.getAttribute("style") ?? "").toBe("");
    binding.unbind();
  });

  it("rounds the fallback like the region, unless the style sets its own radius", () => {
    const element = createElement();
    const binding = bindRegion(element, { cornerRadius: 16 });
    expect(element.style.borderRadius).toBe("16px");

    binding.update({ cornerRadius: 24 });
    expect(element.style.borderRadius).toBe("24px");
    binding.update({ fallback: { borderRadius: "4px" } });
    expect(element.style.borderRadius).toBe("4px");
    expect(element.style.backdropFilter).toBe("");
    binding.unbind();
  });

  it("styles an island's element and ignores its commands", () => {
    const element = createElement();
    const binding = bindIsland(element, { content: ui.text("Hello"), fit: "both" });
    expect(element.style.backdropFilter).toBe(defaultFallbackStyle.backdropFilter);

    binding.setValue("field", "x");
    binding.focus("field");
    binding.update({ content: ui.text("Bye") });
    binding.unbind();

    expect(element.getAttribute("style") ?? "").toBe("");
  });
});

describe("with a bridge", () => {
  it("caches capabilities per bridge", async () => {
    const bridge = installBridge();
    const ask = vi.spyOn(bridge, "capabilities");
    await expect(getCapabilities()).resolves.toEqual(MAC);
    await getCapabilities();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("resolves to no capabilities when the main process does not answer", async () => {
    const bridge = installBridge();
    vi.spyOn(bridge, "capabilities").mockRejectedValue(new Error("no handler registered"));
    await expect(getCapabilities()).resolves.toMatchObject({ glass: false, islands: false });
  });

  it("uses native glass and no fallback styles where glass is supported", async () => {
    const bridge = installBridge();
    const element = createElement();
    const binding = bindRegion(element);
    await settle();
    page.frame();

    expect(element.getAttribute("style") ?? "").toBe("");
    expect(bridge.commit).toHaveBeenCalledTimes(1);
    binding.unbind();
  });

  it("uses the native blur, not CSS, where only the native fallback exists", async () => {
    installBridge({ ...UNSUPPORTED, fallback: true });
    const element = createElement();
    const binding = bindRegion(element);
    await settle();
    expect(element.getAttribute("style") ?? "").toBe("");
    binding.unbind();
  });

  it("switches to the CSS fallback and stops tracking where glass is unsupported", async () => {
    const bridge = installBridge(UNSUPPORTED);
    const element = createElement();
    const binding = bindRegion(element, { fallback: { opacity: "0.5" } });
    expect(element.style.opacity).toBe("");

    await settle();
    page.frame();

    expect(element.style.opacity).toBe("0.5");
    expect(bridge.commit).not.toHaveBeenCalled();
    expect(bridge.listenerCount()).toBe(0);
    expect(page.pendingFrames()).toBe(0);

    binding.unbind();
    expect(element.getAttribute("style") ?? "").toBe("");
  });

  it("does not style an element that was unbound before the answer arrived", async () => {
    installBridge(UNSUPPORTED);
    const element = createElement();
    bindRegion(element).unbind();
    await settle();
    expect(element.getAttribute("style") ?? "").toBe("");
  });

  it("falls back for islands by their own capability", async () => {
    installBridge({ ...MAC, islands: false });
    const region = createElement();
    const island = createElement();
    const bindings = [bindRegion(region), bindIsland(island, { content: ui.text("Hello") })];
    await settle();

    expect(region.getAttribute("style") ?? "").toBe("");
    expect(island.style.backdropFilter).toBe(defaultFallbackStyle.backdropFilter);
    for (const binding of bindings) binding.unbind();
  });
});
