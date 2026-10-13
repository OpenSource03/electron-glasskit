import type { IslandEvent } from "../shared/nodes.js";
import type { Size } from "../shared/types.js";
import type { NativeBinding } from "./native.js";

/** What a glass object needs from the window it lives in. */
export interface HostContext {
  readonly native: NativeBinding;
  /** The window's native handle. Throws once the window is destroyed. */
  handle(): Buffer;
  contentSize(): Size;
  /** Calls `relayout` after every window resize. Returns the function that stops it. */
  onLayout(relayout: () => void): () => void;
  /** Routes native events for one object. Returns the function that stops it. */
  onEvent(id: number, listener: (event: IslandEvent) => void): () => void;
  /** Called by an object when it is removed. */
  release(object: { remove(): void }): void;
}
