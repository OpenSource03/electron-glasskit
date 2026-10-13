import { describe, expect, it } from "vitest";
import { normalizeColor } from "../../../src/main/color.js";
import { untyped } from "./helpers/untyped.js";

describe("normalizeColor", () => {
  it("expands #RGB to opaque #RRGGBBAA", () => {
    expect(normalizeColor("#1a2")).toBe("#11AA22FF");
  });

  it("makes #RRGGBB opaque", () => {
    expect(normalizeColor("#102030")).toBe("#102030FF");
  });

  it("keeps the alpha of #RRGGBBAA", () => {
    expect(normalizeColor("#10203040")).toBe("#10203040");
  });

  it("upper-cases the digits", () => {
    expect(normalizeColor("#abcdef0a")).toBe("#ABCDEF0A");
  });

  it("accepts upper-case and mixed-case input", () => {
    expect(normalizeColor("#AbC")).toBe("#AABBCCFF");
  });

  it.each([
    ["a missing hash", "ff0000"],
    ["a four-digit form", "#ff00"],
    ["a five-digit form", "#ff000"],
    ["a seven-digit form", "#ff00000"],
    ["a nine-digit form", "#ff0000000"],
    ["a non-hex digit", "#ggg"],
    ["a named colour", "red"],
    ["a CSS function", "rgb(255, 0, 0)"],
    ["an empty string", ""],
    ["surrounding whitespace", " #fff "],
    ["a trailing newline", "#fff\n"],
  ])("rejects %s", (_name, color) => {
    expect(() => normalizeColor(color)).toThrow(TypeError);
  });

  it("names the rejected value and the accepted forms in the error", () => {
    expect(() => normalizeColor("red")).toThrow('Invalid colour "red". Use #RGB, #RRGGBB or #RRGGBBAA.');
  });

  it("rejects a value that is not a string, as an untyped caller could pass", () => {
    expect(() => normalizeColor(untyped<string>("255"))).toThrow("Invalid colour 255.");
  });
});
