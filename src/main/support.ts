import type { BrowserWindowConstructorOptions } from "electron";
import type { Capabilities } from "../shared/types.js";
import { getNative } from "./native.js";

const UNAVAILABLE: Omit<Capabilities, "platform"> = {
  osVersion: null,
  glass: false,
  fallback: false,
  interactiveRegions: false,
  islands: false,
};

/** What this machine can show. Safe to call on any platform. */
export function getCapabilities(): Capabilities {
  // JSON written by our own native code; an empty object off macOS.
  const reported = JSON.parse(getNative().capabilities()) as Partial<Capabilities>;
  return { ...UNAVAILABLE, ...reported, platform: process.platform };
}

/** True when real Liquid Glass is available (macOS 26 and later). */
export function isGlassSupported(): boolean {
  return getCapabilities().glass;
}

export type GlassWindowOptions = Pick<
  BrowserWindowConstructorOptions,
  "transparent" | "backgroundColor" | "titleBarStyle"
>;

/**
 * Window options a glass background needs: a see-through window that keeps its shadow,
 * rounded corners and traffic lights. Empty where glass and its fallback are unavailable,
 * so the same code gives an ordinary opaque window on Windows and Linux.
 */
export function glassWindowOptions(): GlassWindowOptions {
  const { glass, fallback } = getCapabilities();
  if (!glass && !fallback) return {};
  return { transparent: true, backgroundColor: "#00000000", titleBarStyle: "hiddenInset" };
}
