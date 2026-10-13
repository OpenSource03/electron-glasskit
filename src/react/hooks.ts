import { useEffect, useState } from "react";
import {
  bindIsland,
  bindRegion,
  type Capabilities,
  getCapabilities,
  type IslandBindingOptions,
  type IslandEventOf,
  type NodeValue,
  type RegionBindingOptions,
} from "../renderer/index.js";
import { type ElementRef, useBinding, useLatest } from "./internal.js";

/** Handlers for what happens inside an island. Each receives the event with the id of its `node`. */
export interface IslandEventHandlers {
  onPress?: (event: IslandEventOf<"press">) => void;
  onChange?: (event: IslandEventOf<"change">) => void;
  onSubmit?: (event: IslandEventOf<"submit">) => void;
  onFocus?: (event: IslandEventOf<"focus">) => void;
  onBlur?: (event: IslandEventOf<"blur">) => void;
  /** The size the content wants. With `fit`, it has already been applied to the element. */
  onResize?: (event: IslandEventOf<"resize">) => void;
}

export interface GlassIslandHandle<E extends HTMLElement = HTMLDivElement> {
  /** The element the island is placed at, or `null` while there is none. */
  readonly element: E | null;
  /** Sets the value of the control with id `node`. */
  setValue(node: string, value: NodeValue): void;
  /** Moves keyboard focus to the control with id `node`. */
  focus(node: string): void;
}

export interface UseGlassIslandOptions extends IslandBindingOptions, IslandEventHandlers {}

/** What the system supports, or `null` until the answer arrives. */
export function useGlassCapabilities(): Capabilities | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  useEffect(() => {
    let mounted = true;
    void getCapabilities().then((result) => {
      if (mounted) setCapabilities(result);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return capabilities;
}

/**
 * Returns a ref. The element it is attached to has glass at its box for as long as it
 * is attached: `<div ref={useGlassRegion({ cornerRadius: 12 })} />`.
 */
export function useGlassRegion(options: RegionBindingOptions = {}): ElementRef<HTMLElement> {
  return useBinding(options, bindRegion).ref;
}

/**
 * Returns a ref and a handle. The element the ref is attached to has a native island at
 * its box for as long as it is attached; the handle talks to the island's controls.
 */
export function useGlassIsland<E extends HTMLElement = HTMLElement>(
  options: UseGlassIslandOptions,
): [ref: ElementRef<E>, island: GlassIslandHandle<E>] {
  const { onPress, onChange, onSubmit, onFocus, onBlur, onResize, ...island } = options;
  const handlers = useLatest<IslandEventHandlers>({ onPress, onChange, onSubmit, onFocus, onBlur, onResize });

  const { ref, element, binding } = useBinding(island, (target: E, initial: IslandBindingOptions) => {
    const bound = bindIsland(target, initial);
    bound.on("press", (event) => handlers.current.onPress?.(event));
    bound.on("change", (event) => handlers.current.onChange?.(event));
    bound.on("submit", (event) => handlers.current.onSubmit?.(event));
    bound.on("focus", (event) => handlers.current.onFocus?.(event));
    bound.on("blur", (event) => handlers.current.onBlur?.(event));
    bound.on("resize", (event) => handlers.current.onResize?.(event));
    return bound;
  });

  const [handle] = useState<GlassIslandHandle<E>>(() => ({
    get element(): E | null {
      return element.current;
    },
    setValue: (node: string, value: NodeValue) => binding.current?.setValue(node, value),
    focus: (node: string) => binding.current?.focus(node),
  }));
  return [ref, handle];
}
