import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNative } from "../../../src/main/native.js";
import { installPreload, preloadPath } from "../../../src/main/preload.js";
import { Channel } from "../../../src/shared/protocol.js";
import { asSession, FakeSession, ipcMain } from "./helpers/electron.js";
import { FakeNative, GLASS_CAPABILITIES } from "./helpers/native.js";

vi.mock("electron", () => import("./helpers/electron.js"));

afterEach(() => {
  setNative(undefined);
});

describe("preloadPath", () => {
  it("is the absolute path of preload.cjs next to the built entry point", () => {
    expect(path.isAbsolute(preloadPath)).toBe(true);
    expect(path.basename(preloadPath)).toBe("preload.cjs");
  });
});

describe("installPreload", () => {
  it("registers the preload script for every frame of the session", () => {
    const session = new FakeSession();
    installPreload(asSession(session));
    expect(session.registered).toStrictEqual([{ type: "frame", filePath: preloadPath }]);
  });

  it("returns the registration id", () => {
    expect(installPreload(asSession(new FakeSession()))).toBe("preload-1");
  });

  it("starts answering capability requests, so pages can ask before any window is attached", () => {
    setNative(new FakeNative());
    installPreload(asSession(new FakeSession()));
    expect(ipcMain.invoke(Channel.capabilities)).toStrictEqual({ ...GLASS_CAPABILITIES, platform: process.platform });
  });
});
