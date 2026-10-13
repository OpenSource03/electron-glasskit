import type { GroupOptions } from "../shared/types.js";
import { invalidate } from "./tracker.js";
import type { GroupBinding } from "./types.js";

const live = new WeakMap<GroupBinding, GroupOptions>();
let count = 0;

/** The options of a group that has not been removed. */
export function groupOptions(group: GroupBinding): GroupOptions | undefined {
  return live.get(group);
}

/** Creates a group. Regions bound with `{ group }` merge into each other like drops of liquid. */
export function createGroup(options: GroupOptions = {}): GroupBinding {
  const group: GroupBinding = {
    key: `group:${++count}`,
    update(next: GroupOptions): void {
      const current = live.get(group);
      if (!current) return;
      live.set(group, { ...current, ...next });
      invalidate();
    },
    remove(): void {
      if (live.delete(group)) invalidate();
    },
  };
  live.set(group, { ...options });
  return group;
}
