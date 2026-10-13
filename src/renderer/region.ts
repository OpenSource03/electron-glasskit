import type { BoundRegion } from "../shared/protocol.js";
import type { Capabilities, GroupOptions } from "../shared/types.js";
import { attach } from "./attachment.js";
import { resolveFallback } from "./fallback.js";
import { groupOptions } from "./group.js";
import { itemKey } from "./keys.js";
import { invalidate, type Source, type Unplaced } from "./tracker.js";
import type { RegionBinding, RegionBindingOptions } from "./types.js";

const supported = (capabilities: Capabilities): boolean => capabilities.glass || capabilities.fallback;

/**
 * Puts a piece of glass at the element's box and keeps it there. The element's own
 * content is drawn under the glass.
 */
export function bindRegion(element: HTMLElement, options: RegionBindingOptions = {}): RegionBinding {
  let current = options;
  const key = itemKey("region", element);

  const source: Source = {
    key,
    element,
    tracking: current.tracking ?? "auto",
    fit: "none",
    describe(hidden: boolean, groups: Record<string, GroupOptions>): Unplaced {
      const { tracking, fallback, group, ...material } = current;
      const merging = group ? groupOptions(group) : undefined;
      const region: Omit<BoundRegion, "rect"> = {
        kind: "region",
        key,
        options: { ...material, hidden: hidden || material.hidden === true },
      };
      if (!group || !merging) return region;
      groups[group.key] = merging;
      return { ...region, group: group.key };
    },
  };
  const attachment = attach(source, supported, resolveFallback(current.fallback, current.cornerRadius));

  return {
    element,
    update(next: Partial<RegionBindingOptions>): void {
      current = { ...current, ...next };
      source.tracking = current.tracking ?? "auto";
      attachment.setFallback(resolveFallback(current.fallback, current.cornerRadius));
      invalidate();
    },
    unbind(): void {
      attachment.detach();
    },
  };
}
