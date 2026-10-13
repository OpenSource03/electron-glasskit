import { describe, expect, it } from "vitest";
import { fitFrame, resolveFrame } from "../../../src/main/geometry.js";
import type { Alignment } from "../../../src/shared/nodes.js";
import type { Rect } from "../../../src/shared/types.js";
import { untyped } from "./helpers/untyped.js";

const CONTENT = { width: 800, height: 600 };

describe("resolveFrame", () => {
  it("returns a fixed rectangle unchanged", () => {
    expect(resolveFrame({ x: 10, y: 20, width: 30, height: 40 }, CONTENT)).toStrictEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it("returns a copy, not the rectangle it was given", () => {
    const input = { x: 1, y: 2, width: 3, height: 4 };
    expect(resolveFrame(input, CONTENT)).not.toBe(input);
  });

  it("calls a function frame with the window's content size", () => {
    const frame = resolveFrame(({ width, height }) => ({ x: 0, y: height - 50, width, height: 50 }), CONTENT);
    expect(frame).toStrictEqual({ x: 0, y: 550, width: 800, height: 50 });
  });

  it("drops extra keys on the rectangle", () => {
    const input = { x: 1, y: 2, width: 3, height: 4, top: 9 };
    expect(resolveFrame(input, CONTENT)).toStrictEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("clamps a negative width and height to zero", () => {
    expect(resolveFrame({ x: -5, y: -6, width: -1, height: -2 }, CONTENT)).toStrictEqual({
      x: -5,
      y: -6,
      width: 0,
      height: 0,
    });
  });

  it.each([
    ["x", Number.NaN],
    ["y", Number.POSITIVE_INFINITY],
    ["width", Number.NEGATIVE_INFINITY],
    ["height", Number.NaN],
  ] as const)("rejects a non-finite %s", (key, value) => {
    const input = { x: 0, y: 0, width: 10, height: 10, [key]: value };
    expect(() => resolveFrame(input, CONTENT)).toThrow(
      new TypeError(`Invalid frame: "${key}" must be a finite number, got ${value}.`),
    );
  });

  it("rejects a function frame that returns a non-finite value", () => {
    expect(() => resolveFrame(({ width }) => ({ x: width / 0, y: 0, width: 1, height: 1 }), CONTENT)).toThrow(
      TypeError,
    );
  });

  it("rejects a function frame that returns nothing, as an untyped caller could write", () => {
    expect(() => resolveFrame(() => untyped<Rect>("null"), CONTENT)).toThrow(
      'Invalid frame: "x" must be a finite number, got undefined.',
    );
  });
});

describe("fitFrame", () => {
  const frame = { x: 100, y: 200, width: 300, height: 100 };
  const size = { width: 200, height: 40 };

  it("leaves the frame alone when nothing is fitted", () => {
    expect(fitFrame(frame, size, "none", "center")).toStrictEqual(frame);
  });

  it("takes only the width when fitting the width", () => {
    expect(fitFrame(frame, size, "width", "topLeading")).toStrictEqual({ x: 100, y: 200, width: 200, height: 100 });
  });

  it("takes only the height when fitting the height", () => {
    expect(fitFrame(frame, size, "height", "topLeading")).toStrictEqual({ x: 100, y: 200, width: 300, height: 40 });
  });

  it("takes both when fitting both", () => {
    expect(fitFrame(frame, size, "both", "topLeading")).toStrictEqual({ x: 100, y: 200, width: 200, height: 40 });
  });

  // The frame shrinks by 100 x 60, so the anchor decides how much of that moves the origin.
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
    expect(fitFrame(frame, size, "both", anchor)).toStrictEqual({ x, y, width: 200, height: 40 });
  });

  it("moves the origin outwards when the content is larger than the frame", () => {
    expect(fitFrame(frame, { width: 400, height: 140 }, "both", "bottomTrailing")).toStrictEqual({
      x: 0,
      y: 160,
      width: 400,
      height: 140,
    });
  });

  it("does not move an unfitted axis, whatever the anchor", () => {
    expect(fitFrame(frame, size, "width", "bottomTrailing")).toStrictEqual({ x: 200, y: 200, width: 200, height: 100 });
  });

  it("does not change the frame it was given", () => {
    const input = { ...frame };
    fitFrame(input, size, "both", "center");
    expect(input).toStrictEqual(frame);
  });
});
