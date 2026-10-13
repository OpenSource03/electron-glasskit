import { type Ref, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Layout effects warn during server rendering, where bindings do nothing anyway. */
export const useIsomorphicLayoutEffect: typeof useLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A callback ref. It is called with `null` on detach, which React 18 and 19 both do when no cleanup is returned. */
export type ElementRef<E extends HTMLElement> = (element: E | null) => void;

interface Binding<O> {
  update(options: Partial<O>): void;
  unbind(): void;
}

export interface BoundRef<E extends HTMLElement, B> {
  /** Stable for the life of the component. */
  ref: ElementRef<E>;
  element: RefObject<E | null>;
  binding: RefObject<B | null>;
}

/**
 * Binds whatever element `ref` is attached to, for as long as it is attached, and sends
 * option changes as updates. Options are compared by value, so objects rebuilt on every
 * render cost nothing. `bind` is read once and must not depend on render state.
 */
export function useBinding<E extends HTMLElement, O extends object, B extends Binding<O>>(
  options: O,
  bind: (element: E, options: O) => B,
): BoundRef<E, B> {
  const element = useRef<E | null>(null);
  const binding = useRef<B | null>(null);
  // The options the binding has, or will be created with.
  const current = useRef(options);
  const serialized = JSON.stringify(options);

  const [ref] = useState<ElementRef<E>>(() => (next: E | null): void => {
    binding.current?.unbind();
    element.current = next;
    binding.current = next && bind(next, current.current);
  });

  // Keyed on `serialized`, which is `options` by value.
  useIsomorphicLayoutEffect(() => {
    if (current.current === options) return;
    // Bindings merge updates, so keys that disappeared are reset explicitly.
    const dropped = Object.fromEntries(Object.keys(current.current).map((key) => [key, undefined]));
    current.current = options;
    binding.current?.update({ ...dropped, ...options });
  }, [serialized]);

  return { ref, element, binding };
}

/** A ref that always holds the latest `value`, for callbacks that must not re-subscribe. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsomorphicLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Gives `node` to a ref. Returns the function that takes it back. */
function attach<T>(ref: Ref<T> | undefined, node: T): () => void {
  if (typeof ref === "function") {
    // Only a function is a React 19 cleanup; callback refs often return something else by accident.
    const cleanup = ref(node);
    return typeof cleanup === "function" ? cleanup : () => void ref(null);
  }
  if (!ref) return () => {};
  ref.current = node;
  return () => {
    ref.current = null;
  };
}

/**
 * A stable callback ref that feeds `own` and the ref a parent forwarded. Stable because
 * `own` binds on attach: a new function every render would rebind every render.
 */
export function useMergedRef<E extends HTMLElement>(own: ElementRef<E>, forwarded: Ref<E> | undefined): ElementRef<E> {
  const node = useRef<E | null>(null);
  const target = useRef(forwarded);
  const detach = useRef<(() => void) | null>(null);

  const [merged] = useState<ElementRef<E>>(() => (next: E | null): void => {
    own(next);
    detach.current?.();
    node.current = next;
    detach.current = next && attach(target.current, next);
  });

  // The parent's ref changed while the element stayed: hand the element over, as React would.
  useIsomorphicLayoutEffect(() => {
    if (target.current === forwarded) return;
    target.current = forwarded;
    if (!node.current) return;
    detach.current?.();
    detach.current = attach(forwarded, node.current);
  }, [forwarded]);

  return merged;
}
