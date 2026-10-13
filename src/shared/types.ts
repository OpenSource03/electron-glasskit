/** A rectangle in window content coordinates: points, origin at the top-left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
export type Color = string;

export type GlassStyle = "regular" | "clear";

/** `auto` follows the window; `light` and `dark` pin the glass to one look. */
export type GlassAppearance = "auto" | "light" | "dark";

/**
 * Undocumented system materials. They can change or disappear in any macOS update
 * and are not safe for the Mac App Store.
 */
export const GlassVariant = {
  regular: 0,
  clear: 1,
  dock: 2,
  appIcons: 3,
  widgets: 4,
  text: 5,
  avplayer: 6,
  facetime: 7,
  controlCenter: 8,
  notificationCenter: 9,
  monogram: 10,
  bubbles: 11,
  identity: 12,
  focusBorder: 13,
  focusPlatter: 14,
  keyboard: 15,
  sidebar: 16,
  abuttedSidebar: 17,
  inspector: 18,
  control: 19,
  loupe: 20,
  slider: 21,
  camera: 22,
  cartouchePopover: 23,
} as const;

export type GlassVariant = (typeof GlassVariant)[keyof typeof GlassVariant];

/** How a piece of glass looks. Shared by regions and the window background. */
export interface GlassMaterial {
  /** @default "regular" */
  style?: GlassStyle;
  /** Colour the glass leans toward. `null` removes a tint set earlier. */
  tint?: Color | null;
  /** @default "auto" */
  appearance?: GlassAppearance;
  /** Undocumented material preset. See {@link GlassVariant}. */
  unstable_variant?: GlassVariant;
  /** Undocumented: dims the glass the way the system does behind a sheet. */
  unstable_scrim?: boolean;
  /** Undocumented: the muted look glass takes in inactive windows. */
  unstable_subdued?: boolean;
}

export interface RegionOptions extends GlassMaterial {
  frame: Rect;
  /** @default 0 */
  cornerRadius?: number;
  /**
   * Press feedback from the system (macOS 27 and later). An interactive region
   * receives clicks, so the page underneath it does not.
   * @default false
   */
  interactive?: boolean;
  /**
   * Let clicks fall through to the page underneath.
   * @default true, or false when `interactive` is set
   */
  passthrough?: boolean;
  /** Stacking order among glass in the same window. Higher is closer to the viewer. @default 0 */
  zIndex?: number;
  /** @default false */
  hidden?: boolean;
}

export type RegionUpdate = Partial<RegionOptions>;

export interface GroupOptions {
  /**
   * Distance, in points, at which regions in the group start to flow into each other.
   * @default 0
   */
  spacing?: number;
  /** @default 0 */
  zIndex?: number;
}

/** Materials used when Liquid Glass is unavailable (macOS 25 and earlier). */
export type VibrancyMaterial =
  | "underWindow"
  | "sidebar"
  | "hud"
  | "popover"
  | "menu"
  | "headerView"
  | "contentBackground"
  | "windowBackground";

export interface BackgroundOptions extends GlassMaterial {
  /** @default 0 — the window's own shape already clips the glass */
  cornerRadius?: number;
  /**
   * Put the window's standard background colour behind the glass, so the desktop
   * does not show through.
   * @default false
   */
  opaque?: boolean;
  /** Blur used on systems without Liquid Glass. `null` disables the fallback. @default "underWindow" */
  fallbackMaterial?: VibrancyMaterial | null;
}

export interface Capabilities {
  platform: string;
  /** macOS version as `major.minor.patch`, or `null` off macOS. */
  osVersion: string | null;
  /** Real Liquid Glass is available (macOS 26 and later). */
  glass: boolean;
  /** Regions fall back to a blur when glass is unavailable. */
  fallback: boolean;
  /** `interactive` regions get system press feedback (macOS 27 and later). */
  interactiveRegions: boolean;
  /** Native SwiftUI islands can be created (macOS 14 and later; glass inside them needs macOS 26). */
  islands: boolean;
}
