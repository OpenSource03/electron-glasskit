import type { IslandEvent, IslandEventOf, IslandEventType, NodeValue } from "../shared/nodes.js";
import type { IslandFit } from "../shared/protocol.js";
import type { Capabilities, Size } from "../shared/types.js";
import { attach } from "./attachment.js";
import { resolveFallback } from "./fallback.js";
import { createSizer } from "./fit.js";
import { itemKey } from "./keys.js";
import { invalidate, type Source, sendCommand, type Unplaced } from "./tracker.js";
import type { IslandBinding, IslandBindingOptions } from "./types.js";

const supported = (capabilities: Capabilities): boolean => capabilities.islands;

function isEvent<T extends IslandEventType>(event: IslandEvent, type: T): event is IslandEventOf<T> {
  return event.type === type;
}

/**
 * Places a native SwiftUI view tree at the element's box and keeps it there.
 * The tree is described by `content` and reports interaction through `on`.
 */
export function bindIsland(element: HTMLElement, options: IslandBindingOptions): IslandBinding {
  let current = options;
  let reported: Size | null = null;
  const key = itemKey("island", element);
  const listeners = new Set<(event: IslandEvent) => void>();
  const sizer = createSizer(element);

  const appliedFit = (): IslandFit => (current.applySize === false ? "none" : (current.fit ?? "none"));

  const source: Source = {
    key,
    element,
    tracking: current.tracking ?? "auto",
    fit: current.fit ?? "none",
    describe(hidden: boolean): Unplaced {
      const { tracking, fallback, applySize, ...island } = current;
      return { kind: "island", key, ...island, hidden: hidden || island.hidden === true };
    },
    onEvent(event: IslandEvent): void {
      if (event.type === "resize") {
        reported = event.size;
        sizer.sync(reported, appliedFit());
      }
      for (const listener of [...listeners]) listener(event);
    },
  };
  const attachment = attach(source, supported, resolveFallback(current.fallback));

  return {
    element,
    update(next: Partial<IslandBindingOptions>): void {
      current = { ...current, ...next };
      source.tracking = current.tracking ?? "auto";
      source.fit = current.fit ?? "none";
      sizer.sync(reported, appliedFit());
      attachment.setFallback(resolveFallback(current.fallback));
      invalidate();
    },
    setValue(node: string, value: NodeValue): void {
      sendCommand(source, { type: "setValue", key, node, value });
    },
    focus(node: string): void {
      sendCommand(source, { type: "focus", key, node });
    },
    on<T extends IslandEventType>(type: T, listener: (event: IslandEventOf<T>) => void): () => void {
      const wrapped = (event: IslandEvent): void => {
        if (isEvent(event, type)) listener(event);
      };
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    unbind(): void {
      attachment.detach();
      sizer.restore();
      listeners.clear();
    },
  };
}
