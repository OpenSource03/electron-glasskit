import type { IslandEvent } from "../shared/nodes.js";
import type { NativeBinding } from "./native.js";

type Listener = (event: IslandEvent) => void;

const routes = new WeakMap<NativeBinding, Map<number, Listener>>();

/** Delivers native events for object `id` to `listener`. Returns the function that stops it. */
export function subscribe(native: NativeBinding, id: number, listener: Listener): () => void {
  let listeners = routes.get(native);
  if (!listeners) {
    const created = new Map<number, Listener>();
    routes.set(native, created);
    // The payload is JSON produced by our own native code, in the IslandEvent shape.
    native.setEventCallback((target, json) => created.get(target)?.(JSON.parse(json) as IslandEvent));
    listeners = created;
  }
  listeners.set(id, listener);
  return () => listeners.delete(id);
}
