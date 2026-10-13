import { describe, expect, it } from "vitest";
import * as renderer from "../../../src/renderer/index.js";

// Runs in Node, where neither `window` nor `document` exists.
describe("without a DOM", () => {
  it("imports and reports that nothing is available", async () => {
    expect(typeof window).toBe("undefined");
    expect(renderer.isAvailable()).toBe(false);
    await expect(renderer.getCapabilities()).resolves.toMatchObject({ glass: false, islands: false });
    expect(() => renderer.refresh()).not.toThrow();
    expect(() => renderer.createGroup({ spacing: 8 }).update({ spacing: 4 })).not.toThrow();
  });
});
