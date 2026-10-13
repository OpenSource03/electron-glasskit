import { type Mock, vi } from "vitest";
import type { EventMessage, GlasskitBridge } from "../../../src/shared/protocol.js";
import type { Capabilities, Rect } from "../../../src/shared/types.js";

export const MAC: Capabilities = {
  platform: "darwin",
  osVersion: "26.0.0",
  glass: true,
  fallback: true,
  interactiveRegions: false,
  islands: true,
};

export const UNSUPPORTED: Capabilities = {
  ...MAC,
  platform: "win32",
  osVersion: null,
  glass: false,
  fallback: false,
  islands: false,
};

export interface FakeBridge extends GlasskitBridge {
  commit: Mock<GlasskitBridge["commit"]>;
  frames: Mock<GlasskitBridge["frames"]>;
  command: Mock<GlasskitBridge["command"]>;
  /** Delivers an island event the way the main process would. */
  emit(message: EventMessage): void;
  /** Asks for everything again the way the main process would. */
  resync(): void;
  /** Event and resync listeners still subscribed. */
  listenerCount(): number;
}

export function installBridge(capabilities: Capabilities = MAC): FakeBridge {
  const listeners = new Set<(message: EventMessage) => void>();
  const resyncListeners = new Set<() => void>();
  const bridge: FakeBridge = {
    capabilities: () => Promise.resolve(capabilities),
    commit: vi.fn(),
    frames: vi.fn(),
    command: vi.fn(),
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onResync(listener) {
      resyncListeners.add(listener);
      return () => {
        resyncListeners.delete(listener);
      };
    },
    emit(message) {
      for (const listener of [...listeners]) listener(message);
    },
    resync() {
      for (const listener of [...resyncListeners]) listener();
    },
    listenerCount: () => listeners.size + resyncListeners.size,
  };
  window.glasskit = bridge;
  return bridge;
}

export function removeBridge(): void {
  delete window.glasskit;
}

export interface Page {
  /** Runs the animation frame callbacks queued so far. */
  frame(): void;
  pendingFrames(): number;
  /** Fires every live ResizeObserver. */
  resize(): void;
  observed(): Element[];
}

/** Replaces requestAnimationFrame and ResizeObserver with ones the test drives. */
export function installPage(): Page {
  let queue: FrameRequestCallback[] = [];
  const observers = new Set<FakeResizeObserver>();

  class FakeResizeObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: () => void) {
      observers.add(this);
    }
    observe(target: Element): void {
      this.targets.add(target);
    }
    unobserve(target: Element): void {
      this.targets.delete(target);
    }
    disconnect(): void {
      observers.delete(this);
    }
  }

  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => queue.push(callback));

  return {
    frame() {
      const callbacks = queue;
      queue = [];
      for (const callback of callbacks) callback(0);
    },
    pendingFrames: () => queue.length,
    resize() {
      for (const observer of observers) observer.callback();
    },
    observed: () => [...observers].flatMap((observer) => [...observer.targets]),
  };
}

/** Gives an element a layout box, which happy-dom does not compute. */
export function place(element: Element, rect: Rect, boxes = 1): void {
  const box = new DOMRect(rect.x, rect.y, rect.width, rect.height);
  element.getBoundingClientRect = () => box;
  element.getClientRects = () =>
    Object.assign(
      Array.from({ length: boxes }, () => box),
      { item: () => box },
    );
}

export function createElement(rect: Rect = { x: 10, y: 20, width: 300, height: 40 }): HTMLDivElement {
  const element = document.createElement("div");
  document.body.append(element);
  place(element, rect);
  return element;
}

/** Lets pending promise callbacks, such as the capabilities answer, run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
