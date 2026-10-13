import type { Alignment } from "../shared/nodes.js";
import type { IslandFit } from "../shared/protocol.js";
import type { Rect, Size } from "../shared/types.js";

/**
 * Where something sits in the window: a fixed rectangle, or a function of the window's
 * content size that is called again whenever the window resizes.
 */
export type FrameInput = Rect | ((content: Size) => Rect);

export function resolveFrame(input: FrameInput, content: Size): Rect {
  const rect = typeof input === "function" ? input(content) : input;
  for (const key of ["x", "y", "width", "height"] as const) {
    if (!Number.isFinite(rect?.[key])) {
      throw new TypeError(`Invalid frame: "${key}" must be a finite number, got ${String(rect?.[key])}.`);
    }
  }
  return { x: rect.x, y: rect.y, width: Math.max(0, rect.width), height: Math.max(0, rect.height) };
}

/** Fraction of the spare space that goes before the content, per axis. */
const ANCHOR: Record<Alignment, readonly [x: number, y: number]> = {
  topLeading: [0, 0],
  top: [0.5, 0],
  topTrailing: [1, 0],
  leading: [0, 0.5],
  center: [0.5, 0.5],
  trailing: [1, 0.5],
  bottomLeading: [0, 1],
  bottom: [0.5, 1],
  bottomTrailing: [1, 1],
};

/** Resizes `frame` to the fitted axes of `size`, keeping the `anchor` point where it was. */
export function fitFrame(frame: Rect, size: Size, fit: IslandFit, anchor: Alignment): Rect {
  const width = fit === "width" || fit === "both" ? size.width : frame.width;
  const height = fit === "height" || fit === "both" ? size.height : frame.height;
  const [ax, ay] = ANCHOR[anchor];
  return { x: frame.x + (frame.width - width) * ax, y: frame.y + (frame.height - height) * ay, width, height };
}
