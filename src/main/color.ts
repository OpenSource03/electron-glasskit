import type { Color } from "../shared/types.js";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Expands any accepted hex colour to the `#RRGGBBAA` form the native side reads. */
export function normalizeColor(color: Color): string {
  if (typeof color !== "string" || !HEX.test(color)) {
    throw new TypeError(`Invalid colour ${JSON.stringify(color)}. Use #RGB, #RRGGBB or #RRGGBBAA.`);
  }
  const digits = color.slice(1);
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return `#${full.padEnd(8, "f").toUpperCase()}`;
}
