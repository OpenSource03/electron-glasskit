import type { Capabilities } from "../shared/types.js";
import { getCapabilities, isAvailable } from "./bridge.js";
import { applyFallback } from "./fallback.js";
import { type Source, track, untrack } from "./tracker.js";
import type { FallbackStyle } from "./types.js";

export interface Attachment {
  setFallback(style: FallbackStyle | null): void;
  detach(): void;
}

/**
 * Mirrors `source` natively where the system supports it and styles the element
 * with `fallback` where it does not.
 */
export function attach(
  source: Source,
  supported: (capabilities: Capabilities) => boolean,
  fallback: FallbackStyle | null,
): Attachment {
  let style = fallback;
  let attached = true;
  let usesCss = false;
  let restore: (() => void) | null = null;

  const applyCss = (): void => {
    restore?.();
    restore = style && applyFallback(source.element, style);
  };

  if (isAvailable()) {
    // Tracked before the answer arrives so glass shows on the first frame where it is supported.
    track(source);
    void getCapabilities().then((capabilities) => {
      if (!attached || supported(capabilities)) return;
      untrack(source);
      usesCss = true;
      applyCss();
    });
  } else {
    usesCss = true;
    applyCss();
  }

  return {
    setFallback(next: FallbackStyle | null): void {
      if (JSON.stringify(next) === JSON.stringify(style)) return;
      style = next;
      if (usesCss) applyCss();
    },
    detach(): void {
      attached = false;
      untrack(source);
      restore?.();
      restore = null;
    },
  };
}
