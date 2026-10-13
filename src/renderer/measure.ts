import type { IslandFit } from "../shared/protocol.js";
import type { Rect } from "../shared/types.js";

/**
 * The element's viewport box, or `null` when it shows nothing: disconnected,
 * `display: none`, or collapsed on an axis that native content does not size.
 */
export function measure(element: HTMLElement, fit: IslandFit): Rect | null {
  if (!element.isConnected) return null;
  const { x, y, width, height } = element.getBoundingClientRect();
  if (width === 0 || height === 0) {
    const fitsWidth = fit === "width" || fit === "both";
    const fitsHeight = fit === "height" || fit === "both";
    if ((width === 0 && !fitsWidth) || (height === 0 && !fitsHeight)) return null;
    // A fitted island starts collapsed and still has to be shown; `display: none` has no boxes at all.
    if (element.getClientRects().length === 0) return null;
  }
  return { x, y, width, height };
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
