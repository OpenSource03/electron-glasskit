import type { IslandFit } from "../shared/protocol.js";
import type { Size } from "../shared/types.js";

type Axis = "width" | "height";

export interface Sizer {
  /** Writes `size` to the axes `fit` names and puts the others back. */
  sync(size: Size | null, fit: IslandFit): void;
  restore(): void;
}

/** Applies the size native content reports to an element's inline `width` and `height`. */
export function createSizer(element: HTMLElement): Sizer {
  const original: Partial<Record<Axis, string>> = {};
  const applied: Partial<Record<Axis, number>> = {};

  const restoreAxis = (axis: Axis): void => {
    const value = original[axis];
    if (value === undefined) return;
    element.style[axis] = value;
    delete original[axis];
    delete applied[axis];
  };

  const applyAxis = (axis: Axis, value: number, inset: number): void => {
    // Writing only real changes is what keeps resize → layout → resize from looping.
    const last = applied[axis];
    if (last !== undefined && Math.abs(last - value) < 0.5) return;
    original[axis] ??= element.style[axis];
    applied[axis] = value;
    element.style[axis] = `${Math.max(0, value - inset)}px`;
  };

  return {
    sync(size: Size | null, fit: IslandFit): void {
      const fitsWidth = fit === "width" || fit === "both";
      const fitsHeight = fit === "height" || fit === "both";
      if (!fitsWidth) restoreAxis("width");
      if (!fitsHeight) restoreAxis("height");
      if (!size || fit === "none") return;

      // The reported size is the border box; inline sizes are the content box unless told otherwise.
      const computed = getComputedStyle(element);
      const inset = (...properties: string[]): number =>
        computed.boxSizing === "border-box"
          ? 0
          : properties.reduce(
              (sum, property) => sum + (Number.parseFloat(computed.getPropertyValue(property)) || 0),
              0,
            );
      if (fitsWidth) {
        applyAxis(
          "width",
          size.width,
          inset("padding-left", "padding-right", "border-left-width", "border-right-width"),
        );
      }
      if (fitsHeight) {
        applyAxis(
          "height",
          size.height,
          inset("padding-top", "padding-bottom", "border-top-width", "border-bottom-width"),
        );
      }
    },
    restore(): void {
      restoreAxis("width");
      restoreAxis("height");
    },
  };
}
