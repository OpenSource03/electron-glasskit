import type { FallbackStyle } from "./types.js";

/** The CSS stand-in for glass: a blurred, translucent surface that follows the page's `color-scheme`. */
export const defaultFallbackStyle: FallbackStyle = {
  backdropFilter: "blur(20px) saturate(180%)",
  backgroundColor: "color-mix(in srgb, Canvas 60%, transparent)",
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, CanvasText 12%, transparent)",
};

/** The styles a `fallback` option asks for, or `null` for none. */
export function resolveFallback(
  option: boolean | FallbackStyle | undefined,
  cornerRadius?: number,
): FallbackStyle | null {
  if (option === false) return null;
  const style = typeof option === "object" ? option : defaultFallbackStyle;
  return cornerRadius === undefined ? style : { borderRadius: `${cornerRadius}px`, ...style };
}

function cssName(property: string): string {
  return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^(webkit|moz|ms)-/, "-$1-");
}

/** Sets `style` inline on the element. Returns the function that puts back what was there. */
export function applyFallback(element: HTMLElement, style: FallbackStyle): () => void {
  const inline = element.style;
  const previous: Array<[name: string, value: string, priority: string]> = [];
  for (const [property, value] of Object.entries(style)) {
    if (typeof value !== "string") continue;
    const name = cssName(property);
    previous.push([name, inline.getPropertyValue(name), inline.getPropertyPriority(name)]);
    inline.setProperty(name, value);
  }
  return () => {
    for (const [name, value, priority] of previous) {
      if (value === "") inline.removeProperty(name);
      else inline.setProperty(name, value, priority);
    }
  };
}
