export { type LegacyGlassOptions, type LegacyLiquidGlass, liquidGlass } from "./main/compat.js";
export type { ConnectOptions } from "./main/connect.js";
export type { FrameInput } from "./main/geometry.js";
export { attachGlass, GlassHost, type HostInspection, type InspectedObject } from "./main/host.js";
export {
  GlassIsland,
  type GlassIslandListener,
  type GlassIslandOptions,
  type GlassIslandUpdate,
  type SetContentOptions,
} from "./main/island.js";
export {
  GlassBackground,
  GlassGroup,
  GlassObject,
  GlassRegion,
  type GlassRegionOptions,
  type GlassRegionUpdate,
  PlacedGlassObject,
  type SetFrameOptions,
} from "./main/objects.js";
export { GlassPanel, type GlassPanelOptions } from "./main/panel.js";
export { installPreload, preloadPath } from "./main/preload.js";
export { type GlassWindowOptions, getCapabilities, glassWindowOptions, isGlassSupported } from "./main/support.js";
export * from "./shared/nodes.js";
export type { IslandFit } from "./shared/protocol.js";
export * from "./shared/types.js";
