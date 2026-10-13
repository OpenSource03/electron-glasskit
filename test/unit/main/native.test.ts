import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNative, setNative } from "../../../src/main/native.js";
import { FakeNative } from "./helpers/native.js";
import { stubPlatform } from "./helpers/platform.js";

const fs = vi.hoisted(() => ({ existsSync: vi.fn<(file: string) => boolean>() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: fs.existsSync,
}));

let restorePlatform: (() => void) | undefined;

function on(platform: NodeJS.Platform): void {
  restorePlatform = stubPlatform(platform);
}

beforeEach(() => {
  fs.existsSync.mockReset().mockReturnValue(false);
  setNative(undefined);
});

afterEach(() => {
  restorePlatform?.();
  restorePlatform = undefined;
  setNative(undefined);
});

const HANDLE = Buffer.from("handle");

describe("getNative off macOS", () => {
  it.each<NodeJS.Platform>(["linux", "win32"])(
    "returns a binding on %s without touching the filesystem",
    (platform) => {
      on(platform);
      getNative();
      expect(fs.existsSync).not.toHaveBeenCalled();
    },
  );

  it("does not warn", () => {
    on("linux");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getNative();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports no capabilities", () => {
    on("linux");
    expect(getNative().capabilities()).toBe("{}");
  });

  it("answers every create call with id 0", () => {
    on("linux");
    const native = getNative();
    expect([
      native.backgroundSet(HANDLE, "{}"),
      native.groupCreate(HANDLE, "{}"),
      native.regionCreate(HANDLE, 0, "{}"),
      native.islandCreate(HANDLE, "{}"),
    ]).toStrictEqual([0, 0, 0, 0]);
  });

  it("answers that no control or field was found", () => {
    on("linux");
    expect([getNative().islandSetValue(0, "node", "1"), getNative().islandFocus(0, "node")]).toStrictEqual([
      false,
      false,
    ]);
  });

  it("has nothing to inspect", () => {
    on("linux");
    expect(getNative().hostInspect(HANDLE)).toBeNull();
  });

  it("accepts every other call and does nothing", () => {
    on("linux");
    const native = getNative();
    expect(() => {
      native.setEventCallback(() => {});
      native.objectUpdate(0, "{}");
      native.objectSetFrame(0, 0, 0, 1, 1, 0);
      native.objectRemove(0);
      native.islandSetContent(0, "{}", null);
      native.hostDetach(HANDLE);
    }).not.toThrow();
  });

  it("returns the same binding every time", () => {
    on("linux");
    expect(getNative()).toBe(getNative());
  });
});

describe("getNative on macOS without a usable binary", () => {
  it("looks for the prebuilt binary of this architecture, then for a local build", () => {
    on("darwin");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getNative();
    const probed = fs.existsSync.mock.calls.map(([file]) => file);
    expect(probed.some((file) => file.endsWith(`/prebuilds/darwin-${process.arch}/glasskit.node`))).toBe(true);
    expect(probed.some((file) => file.endsWith("/native/build/Release/glasskit.node"))).toBe(true);
  });

  it("warns that glass is disabled and falls back to a binding that does nothing", () => {
    on("darwin");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getNative().capabilities()).toBe("{}");
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `electron-glasskit: no native binary for darwin-${process.arch}; glass is disabled.`,
    );
  });

  it("looks and warns once, not on every call", () => {
    on("darwin");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    getNative();
    const probes = fs.existsSync.mock.calls.length;
    getNative();
    expect(fs.existsSync).toHaveBeenCalledTimes(probes);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warns and falls back when the binary is there but fails to load", () => {
    on("darwin");
    fs.existsSync.mockReturnValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getNative().capabilities()).toBe("{}");
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "electron-glasskit: the native binary failed to load; glass is disabled.",
      expect.any(Error),
    );
  });
});

describe("setNative", () => {
  it("makes getNative return the replacement", () => {
    const fake = new FakeNative();
    setNative(fake);
    expect(getNative()).toBe(fake);
  });

  it("does not look for a binary while a replacement is set", () => {
    on("darwin");
    setNative(new FakeNative());
    getNative();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });

  it("restores normal loading when given undefined", () => {
    on("linux");
    const fake = new FakeNative();
    setNative(fake);
    setNative(undefined);
    expect(getNative()).not.toBe(fake);
    expect(getNative().capabilities()).toBe("{}");
  });
});
