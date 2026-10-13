import type { IslandEventOf, IslandEventType, NodeValue } from "../shared/nodes.js";
import type { BoundIsland } from "../shared/protocol.js";
import type { GroupOptions, RegionOptions } from "../shared/types.js";

/**
 * How an element's box is followed. `auto` measures on resize, scroll and commits;
 * `frame` measures every animation frame, for elements moved by CSS animations or transforms.
 */
export type Tracking = "auto" | "frame";

/** Inline styles that stand in for glass where native glass is unavailable. */
export type FallbackStyle = Partial<CSSStyleDeclaration>;

export interface BindingOptions {
  /** @default "auto" */
  tracking?: Tracking;
  /**
   * CSS approximation used when native glass is unavailable. `true` uses
   * `defaultFallbackStyle`, an object replaces it and `false` leaves the element alone.
   * @default true
   */
  fallback?: boolean | FallbackStyle;
}

export interface RegionBindingOptions extends Omit<RegionOptions, "frame">, BindingOptions {
  /** Regions bound with the same group merge into each other. */
  group?: GroupBinding | null;
}

export interface RegionBinding {
  readonly element: HTMLElement;
  /** Merges `options` into the current ones. A key set to `undefined` returns to its default. */
  update(options: Partial<RegionBindingOptions>): void;
  /** Removes the glass and any fallback styles. */
  unbind(): void;
}

export interface GroupBinding {
  readonly key: string;
  /** Merges `options` into the current ones. */
  update(options: GroupOptions): void;
  /** Regions still bound with this group stop merging. */
  remove(): void;
}

export interface IslandBindingOptions extends Omit<BoundIsland, "kind" | "key" | "rect">, BindingOptions {
  /**
   * Write the size the native content reports to the element's inline `width` and
   * `height`, for the axes named by `fit`, so page layout follows the content.
   * @default true
   */
  applySize?: boolean;
}

export interface IslandBinding {
  readonly element: HTMLElement;
  /** Merges `options` into the current ones. New `content` transitions with `animation`. */
  update(options: Partial<IslandBindingOptions>): void;
  /** Sets the value of the control with id `node`. */
  setValue(node: string, value: NodeValue): void;
  /** Moves keyboard focus to the control with id `node`. */
  focus(node: string): void;
  /** Subscribes to one kind of event. Returns the function that unsubscribes. */
  on<T extends IslandEventType>(type: T, listener: (event: IslandEventOf<T>) => void): () => void;
  /** Removes the island, any fallback styles and any size it applied. */
  unbind(): void;
}
