import { GlassVariant } from "../shared/types.js";
import { normalizeColor } from "./color.js";
import { getNative } from "./native.js";
import { isGlassSupported } from "./support.js";

/** @deprecated Options of electron-liquid-glass's `addView`. Use `attachGlass(window).setBackground()`. */
export interface LegacyGlassOptions {
  cornerRadius?: number;
  tintColor?: string;
  opaque?: boolean;
}

/** @deprecated The electron-liquid-glass API, kept so existing code runs unchanged. */
export interface LegacyLiquidGlass {
  readonly GlassMaterialVariant: typeof GlassVariant;
  isGlassSupported(): boolean;
  /** Puts a glass sheet behind the page of the window `handle` belongs to. Returns its id, or -1. */
  addView(handle: Buffer, options?: LegacyGlassOptions): number;
  unstable_setVariant(id: number, variant: GlassVariant): void;
  unstable_setScrim(id: number, scrim: number): void;
  unstable_setSubdued(id: number, subdued: number): void;
}

const update = (id: number, options: object): void => {
  if (id > 0) getNative().objectUpdate(id, JSON.stringify(options));
};

/**
 * Drop-in replacement for the default export of electron-liquid-glass.
 * @deprecated Use {@link attachGlass} and `setBackground`.
 */
export const liquidGlass: LegacyLiquidGlass = {
  GlassMaterialVariant: GlassVariant,
  isGlassSupported,
  addView(handle, options = {}) {
    if (!Buffer.isBuffer(handle)) throw new TypeError("[liquidGlass.addView] handle must be a Buffer");
    const id = getNative().backgroundSet(
      handle,
      JSON.stringify({
        cornerRadius: options.cornerRadius,
        opaque: options.opaque,
        tint: options.tintColor === undefined ? undefined : normalizeColor(options.tintColor),
      }),
    );
    return id > 0 ? id : -1;
  },
  unstable_setVariant: (id, variant) => update(id, { unstable_variant: variant }),
  unstable_setScrim: (id, scrim) => update(id, { unstable_scrim: scrim !== 0 }),
  unstable_setSubdued: (id, subdued) => update(id, { unstable_subdued: subdued !== 0 }),
};
