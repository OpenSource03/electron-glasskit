import { afterEach, describe, expect, it } from "vitest";
import { liquidGlass } from "../../../src/main/compat.js";
import { setNative } from "../../../src/main/native.js";
import { GlassVariant } from "../../../src/shared/types.js";
import { decode, FakeNative } from "./helpers/native.js";
import { stubPlatform } from "./helpers/platform.js";
import { untyped } from "./helpers/untyped.js";

let restorePlatform: (() => void) | undefined;

afterEach(() => {
  restorePlatform?.();
  restorePlatform = undefined;
  setNative(undefined);
});

function fake(): FakeNative {
  const native = new FakeNative();
  setNative(native);
  return native;
}

const HANDLE = Buffer.from("legacy-handle");

describe("liquidGlass.addView", () => {
  it("puts a background on the window the handle belongs to", () => {
    const native = fake();
    liquidGlass.addView(HANDLE);
    expect(native.calls.backgroundSet[0]?.[0]).toBe(HANDLE);
  });

  it("sends no options when none are given", () => {
    const native = fake();
    liquidGlass.addView(HANDLE);
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({});
  });

  it("sends cornerRadius and opaque, and tintColor as a normalised tint", () => {
    const native = fake();
    liquidGlass.addView(HANDLE, { cornerRadius: 16, opaque: true, tintColor: "#44000010" });
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({
      cornerRadius: 16,
      opaque: true,
      tint: "#44000010",
    });
  });

  it("expands a short tintColor", () => {
    const native = fake();
    liquidGlass.addView(HANDLE, { tintColor: "#f80" });
    expect(decode(native.calls.backgroundSet[0]?.[1] ?? "")).toStrictEqual({ tint: "#FF8800FF" });
  });

  it("returns the id of the view", () => {
    const native = fake();
    expect(liquidGlass.addView(HANDLE)).toBe(native.lastId);
  });

  it("returns -1 where glass is unavailable", () => {
    restorePlatform = stubPlatform("linux");
    setNative(undefined);
    expect(liquidGlass.addView(HANDLE)).toBe(-1);
  });

  it("rejects a handle that is not a Buffer, without calling the addon", () => {
    const native = fake();
    expect(() => liquidGlass.addView(untyped<Buffer>('"handle"'))).toThrow(
      new TypeError("[liquidGlass.addView] handle must be a Buffer"),
    );
    expect(native.calls.backgroundSet).toHaveLength(0);
  });

  it("rejects an invalid tintColor, without calling the addon", () => {
    const native = fake();
    expect(() => liquidGlass.addView(HANDLE, { tintColor: "rgba(0,0,0,0.1)" })).toThrow(TypeError);
    expect(native.calls.backgroundSet).toHaveLength(0);
  });
});

describe("liquidGlass unstable setters", () => {
  it("sets the variant", () => {
    const native = fake();
    liquidGlass.unstable_setVariant(7, GlassVariant.dock);
    expect(native.updatesOf(7)).toStrictEqual([{ unstable_variant: 2 }]);
  });

  it.each([
    [1, true],
    [0, false],
  ])("sets the scrim from %d to %j", (scrim, expected) => {
    const native = fake();
    liquidGlass.unstable_setScrim(7, scrim);
    expect(native.updatesOf(7)).toStrictEqual([{ unstable_scrim: expected }]);
  });

  it.each([
    [1, true],
    [0, false],
  ])("sets subdued from %d to %j", (subdued, expected) => {
    const native = fake();
    liquidGlass.unstable_setSubdued(7, subdued);
    expect(native.updatesOf(7)).toStrictEqual([{ unstable_subdued: expected }]);
  });

  it.each([-1, 0])("ignore the id %d, which addView returns or the addon uses for nothing", (id) => {
    const native = fake();
    liquidGlass.unstable_setVariant(id, GlassVariant.clear);
    liquidGlass.unstable_setScrim(id, 1);
    liquidGlass.unstable_setSubdued(id, 1);
    expect(native.calls.objectUpdate).toHaveLength(0);
  });
});

describe("liquidGlass", () => {
  it("exposes the variants under their legacy name", () => {
    expect(liquidGlass.GlassMaterialVariant).toBe(GlassVariant);
  });

  it("reports glass support from the addon", () => {
    const native = fake();
    native.reported = { glass: false };
    expect(liquidGlass.isGlassSupported()).toBe(false);
    native.reported = { glass: true };
    expect(liquidGlass.isGlassSupported()).toBe(true);
  });
});
