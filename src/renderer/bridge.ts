import { BRIDGE_KEY, type GlasskitBridge } from "../shared/protocol.js";
import type { Capabilities } from "../shared/types.js";

declare global {
  interface Window {
    glasskit?: GlasskitBridge;
  }
}

const UNAVAILABLE: Capabilities = {
  platform: "unknown",
  osVersion: null,
  glass: false,
  fallback: false,
  interactiveRegions: false,
  islands: false,
};

let cache: { bridge: GlasskitBridge; capabilities: Promise<Capabilities> } | undefined;

export function getBridge(): GlasskitBridge | undefined {
  return typeof window === "undefined" ? undefined : window[BRIDGE_KEY];
}

/** Whether the preload bridge is present, i.e. the page runs in a window set up for glasskit. */
export function isAvailable(): boolean {
  return getBridge() !== undefined;
}

/**
 * What the system supports. Cached, and never rejects: without a bridge (a browser,
 * Windows, Linux) every capability is `false`.
 */
export function getCapabilities(): Promise<Capabilities> {
  const bridge = getBridge();
  if (!bridge) return Promise.resolve({ ...UNAVAILABLE });
  if (cache?.bridge !== bridge) {
    cache = { bridge, capabilities: bridge.capabilities().catch(() => ({ ...UNAVAILABLE })) };
  }
  return cache.capabilities;
}
