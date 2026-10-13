import { afterEach, describe, expect, it, vi } from "vitest";
import { attachGlass } from "../../../src/main/host.js";
import { setNative } from "../../../src/main/native.js";
import { getCapabilities, glassWindowOptions, isGlassSupported } from "../../../src/main/support.js";
import { ui } from "../../../src/shared/nodes.js";
import type { Capabilities } from "../../../src/shared/types.js";
import { asWindow, FakeWindow } from "./helpers/electron.js";
import { FakeNative, GLASS_CAPABILITIES } from "./helpers/native.js";
import { stubPlatform } from "./helpers/platform.js";

vi.mock("electron", () => import("./helpers/electron.js"));

let restorePlatform: (() => void) | undefined;

afterEach(() => {
  restorePlatform?.();
  restorePlatform = undefined;
  setNative(undefined);
});

function reporting(reported: Partial<Capabilities>): FakeNative {
  const native = new FakeNative();
  native.reported = reported;
  setNative(native);
  return native;
}

/** Off macOS the addon is never loaded, so the inert binding answers. */
function offMac(platform: NodeJS.Platform = "linux"): void {
  restorePlatform = stubPlatform(platform);
  setNative(undefined);
}

const SEE_THROUGH = { transparent: true, backgroundColor: "#00000000", titleBarStyle: "hiddenInset" };

describe("getCapabilities", () => {
  it("returns what the addon reports, plus the platform", () => {
    reporting(GLASS_CAPABILITIES);
    expect(getCapabilities()).toStrictEqual({ ...GLASS_CAPABILITIES, platform: process.platform });
  });

  it("fills in whatever the addon leaves out as unavailable", () => {
    reporting({ osVersion: "15.4.0", fallback: true });
    expect(getCapabilities()).toStrictEqual({
      platform: process.platform,
      osVersion: "15.4.0",
      glass: false,
      fallback: true,
      interactiveRegions: false,
      islands: false,
    });
  });

  it("takes the platform from the process, whatever the addon says", () => {
    reporting({ ...GLASS_CAPABILITIES, platform: "plan9" });
    expect(getCapabilities().platform).toBe(process.platform);
  });

  it.each<NodeJS.Platform>(["linux", "win32"])("reports everything unavailable on %s", (platform) => {
    offMac(platform);
    expect(getCapabilities()).toStrictEqual({
      platform,
      osVersion: null,
      glass: false,
      fallback: false,
      interactiveRegions: false,
      islands: false,
    });
  });
});

describe("isGlassSupported", () => {
  it("is true when the addon reports glass", () => {
    reporting({ glass: true });
    expect(isGlassSupported()).toBe(true);
  });

  it("is false when only the fallback is available", () => {
    reporting({ glass: false, fallback: true });
    expect(isGlassSupported()).toBe(false);
  });

  it("is false off macOS", () => {
    offMac();
    expect(isGlassSupported()).toBe(false);
  });
});

describe("glassWindowOptions", () => {
  it("asks for a see-through window with an inset title bar when glass is available", () => {
    reporting({ glass: true });
    expect(glassWindowOptions()).toStrictEqual(SEE_THROUGH);
  });

  it("asks for the same window when only the fallback blur is available", () => {
    reporting({ glass: false, fallback: true });
    expect(glassWindowOptions()).toStrictEqual(SEE_THROUGH);
  });

  it("is empty when neither glass nor the fallback is available", () => {
    reporting({ glass: false, fallback: false, islands: true });
    expect(glassWindowOptions()).toStrictEqual({});
  });

  it("is empty off macOS, so the window stays ordinary and opaque", () => {
    offMac("win32");
    expect(glassWindowOptions()).toStrictEqual({});
  });
});

describe("a host off macOS", () => {
  it("reports everything unavailable and the real platform", () => {
    offMac();
    const host = attachGlass(asWindow(new FakeWindow()));
    expect(host.capabilities).toStrictEqual({
      platform: "linux",
      osVersion: null,
      glass: false,
      fallback: false,
      interactiveRegions: false,
      islands: false,
    });
  });

  it("accepts the whole API and hands out objects with id 0", () => {
    offMac();
    const host = attachGlass(asWindow(new FakeWindow()));
    const frame = { x: 0, y: 0, width: 10, height: 10 };
    const group = host.addGroup({ spacing: 8 });
    const island = host.addIsland({ frame, content: ui.text("Hi") });
    const ids = [
      host.setBackground({ tint: "#fff" }).id,
      host.addRegion({ frame }).id,
      group.id,
      group.addRegion({ frame }).id,
      island.id,
    ];
    expect(ids).toStrictEqual([0, 0, 0, 0, 0]);
    expect(island.setValue("control", 1)).toBe(false);
    expect(island.focus("field")).toBe(false);
    expect(host.inspect()).toBeNull();
    expect(() => host.dispose()).not.toThrow();
  });

  it("still validates what it is given", () => {
    offMac();
    const host = attachGlass(asWindow(new FakeWindow()));
    expect(() => host.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 }, tint: "red" })).toThrow(TypeError);
  });
});
