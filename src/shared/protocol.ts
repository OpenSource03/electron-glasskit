import type { GlassNode, IslandAnimation, IslandEvent, NodeValue } from "./nodes.js";
import type { Capabilities, GlassAppearance, GroupOptions, Rect, RegionOptions } from "./types.js";

/** IPC between a page and the main process. Rectangles are in CSS pixels of the page's viewport. */
export const Channel = {
  /** renderer → main (invoke): {@link Capabilities} */
  capabilities: "glasskit:capabilities",
  /** renderer → main (send): {@link CommitMessage}, the complete set of glass the page wants */
  commit: "glasskit:commit",
  /** renderer → main (send): {@link FramesMessage}, geometry only */
  frames: "glasskit:frames",
  /** renderer → main (send): {@link IslandCommand} */
  command: "glasskit:command",
  /** main → renderer (send): {@link EventMessage} */
  event: "glasskit:event",
  /** main → renderer (send, no payload): the page should commit everything again */
  resync: "glasskit:resync",
} as const;

/** How an island sizes itself to its content. */
export type IslandFit = "none" | "width" | "height" | "both";

export interface BoundRegion {
  kind: "region";
  /** Stable for the lifetime of the element it mirrors. */
  key: string;
  rect: Rect;
  options: Omit<RegionOptions, "frame">;
  /** Key of the {@link CommitMessage.groups} entry this region merges within. */
  group?: string;
}

export interface BoundIsland {
  kind: "island";
  key: string;
  rect: Rect;
  content: GlassNode;
  /** Animation for the change from the previously committed content. */
  animation?: IslandAnimation;
  fit?: IslandFit;
  passthrough?: boolean;
  appearance?: GlassAppearance;
  zIndex?: number;
  hidden?: boolean;
}

export type BoundItem = BoundRegion | BoundIsland;

export interface CommitMessage {
  items: BoundItem[];
  groups: Record<string, GroupOptions>;
}

export type FramesMessage = Array<[key: string, x: number, y: number, width: number, height: number]>;

export type IslandCommand =
  | { type: "setValue"; key: string; node: string; value: NodeValue }
  | { type: "focus"; key: string; node: string };

export interface EventMessage {
  key: string;
  event: IslandEvent;
}

/** What the preload script exposes to the page as `window.glasskit`. */
export interface GlasskitBridge {
  capabilities(): Promise<Capabilities>;
  commit(message: CommitMessage): void;
  frames(message: FramesMessage): void;
  command(command: IslandCommand): void;
  /** Subscribes to island events. Returns the function that unsubscribes. */
  onEvent(listener: (message: EventMessage) => void): () => void;
  /**
   * Subscribes to requests for a full commit, sent when the main process starts listening
   * to a page that may already have committed. Returns the function that unsubscribes.
   */
  onResync(listener: () => void): () => void;
}

/** Name of the bridge on `window`. */
export const BRIDGE_KEY = "glasskit";
