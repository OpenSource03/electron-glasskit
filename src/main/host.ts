import type { BaseWindow, WebContents, WebContentsView } from "electron";
import type { IslandEvent } from "../shared/nodes.js";
import type { BackgroundOptions, Capabilities, GroupOptions, Rect, Size } from "../shared/types.js";
import { Connection, type ConnectOptions, route } from "./connect.js";
import type { HostContext } from "./context.js";
import { subscribe } from "./events.js";
import { GlassIsland, type GlassIslandOptions } from "./island.js";
import { getNative, type NativeBinding } from "./native.js";
import { GlassBackground, GlassGroup, GlassRegion, type GlassRegionOptions } from "./objects.js";
import { GlassPanel, type GlassPanelOptions } from "./panel.js";
import { getCapabilities } from "./support.js";

export interface InspectedObject {
  id: number;
  kind: "region" | "group" | "island";
  viewClass: string;
  frame: Rect;
  zIndex: number;
  hidden: boolean;
  /** Regions inside a group, back to front. */
  members?: InspectedObject[];
}

/** The native state of a window, for tests and debugging. Objects are listed back to front. */
export interface HostInspection {
  overlay: { attached: boolean; aboveContent: boolean; frame: Rect; contentFrame: Rect };
  background: { viewClass: string; frame: Rect } | null;
  objects: InspectedObject[];
}

const hosts = new WeakMap<BaseWindow, GlassHost>();

/**
 * Returns the glass host for a window, creating it on first use.
 * Everything it adds is removed when the window closes.
 */
export function attachGlass(window: BaseWindow): GlassHost {
  // Pages ask for capabilities as they load, which can be before they are connected.
  route();
  let host = hosts.get(window);
  if (!host || host.isDisposed) {
    host = new GlassHost(window);
    hosts.set(window, host);
  }
  return host;
}

/** All the glass in one window. Get one with {@link attachGlass}. */
export class GlassHost {
  readonly window: BaseWindow;
  readonly #native: NativeBinding = getNative();
  readonly #objects = new Set<{ remove(): void }>();
  readonly #layouts = new Set<() => void>();
  readonly #connections = new Set<Connection>();
  readonly #panels = new Set<GlassPanel>();
  readonly #context: HostContext;
  #background: GlassBackground | null = null;
  #disposed = false;

  /** @internal Use {@link attachGlass}. */
  constructor(window: BaseWindow) {
    this.window = window;
    this.#context = {
      native: this.#native,
      handle: () => this.#handle(),
      contentSize: () => this.#contentSize(),
      onLayout: (relayout) => {
        this.#layouts.add(relayout);
        return () => this.#layouts.delete(relayout);
      },
      onEvent: (id, listener: (event: IslandEvent) => void) => subscribe(this.#native, id, listener),
      release: (object) => this.#objects.delete(object),
    };
    window.on("resize", this.#relayout);
    window.once("closed", () => this.#teardown());
  }

  get isDisposed(): boolean {
    return this.#disposed;
  }

  get capabilities(): Capabilities {
    return getCapabilities();
  }

  /** The glass behind the page, if {@link setBackground} put one there. */
  get background(): GlassBackground | null {
    return this.#background?.isRemoved ? null : this.#background;
  }

  /**
   * Puts one sheet of glass behind the whole page. The window must be see-through:
   * create it with {@link glassWindowOptions} and give the page a transparent background.
   * Calling it again updates the existing sheet.
   */
  setBackground(options: BackgroundOptions = {}): GlassBackground {
    const existing = this.background;
    if (existing) return existing.update(options);
    this.#background = this.#track(GlassBackground.create(this.#context, options));
    return this.#background;
  }

  clearBackground(): void {
    this.background?.remove();
    this.#background = null;
  }

  /** Adds a piece of glass above the page. */
  addRegion(options: GlassRegionOptions): GlassRegion {
    return this.#track(GlassRegion.create(this.#context, options));
  }

  /** Adds a group whose regions merge when they come close to each other. */
  addGroup(options: GroupOptions = {}): GlassGroup {
    return this.#track(GlassGroup.create(this.#context, options));
  }

  /** Adds a native SwiftUI view tree above the page. */
  addIsland(options: GlassIslandOptions): GlassIsland {
    return this.#track(GlassIsland.create(this.#context, options));
  }

  /** Opens a child window whose HTML sits on top of glass. See {@link GlassPanel}. */
  createPanel(options: GlassPanelOptions): GlassPanel {
    this.#assertUsable();
    const panel = GlassPanel.create(this.window, options, attachGlass);
    this.#panels.add(panel);
    panel.window.once("closed", () => this.#panels.delete(panel));
    return panel;
  }

  /**
   * Lets a page place glass from its own DOM, through `electron-glasskit/renderer` or
   * `electron-glasskit/react`. The page needs the preload script; see {@link installPreload}.
   *
   * Pass the `WebContentsView` when the page does not fill the window, so its offset is applied.
   * Returns the function that disconnects the page and removes its glass.
   */
  connect(target: WebContents | WebContentsView, options: ConnectOptions = {}): () => void {
    this.#assertUsable();
    // The connection also ends on its own when its page is destroyed.
    const connection = new Connection(this, target, options, (ended) => this.#connections.delete(ended));
    this.#connections.add(connection);
    return () => connection.dispose();
  }

  /** Describes the native views in the window. `null` where glass is unavailable. */
  inspect(): HostInspection | null {
    if (this.#disposed) return null;
    const json = this.#native.hostInspect(this.#handle());
    // JSON written by our own native code, in the HostInspection shape.
    return json === null ? null : (JSON.parse(json) as HostInspection);
  }

  /** Removes everything this host added. The window itself is left alone. */
  dispose(): void {
    if (this.#disposed) return;
    const alive = !this.window.isDestroyed();
    this.#teardown();
    if (alive) {
      this.window.off("resize", this.#relayout);
      this.#native.hostDetach(this.window.getNativeWindowHandle());
    }
  }

  #track<Tracked extends { remove(): void }>(object: Tracked): Tracked {
    this.#objects.add(object);
    return object;
  }

  #handle(): Buffer {
    this.#assertUsable();
    return this.window.getNativeWindowHandle();
  }

  #contentSize(): Size {
    this.#assertUsable();
    const { width, height } = this.window.getContentBounds();
    return { width, height };
  }

  #assertUsable(): void {
    if (this.#disposed || this.window.isDestroyed()) throw new Error("This window's glass host is no longer usable.");
  }

  readonly #relayout = (): void => {
    for (const relayout of [...this.#layouts]) relayout();
  };

  // Runs when the window closes too; native state for a closed window is already gone.
  #teardown(): void {
    this.#disposed = true;
    for (const connection of [...this.#connections]) connection.dispose();
    for (const panel of this.#panels) panel.close();
    for (const object of [...this.#objects]) object.remove();
    this.#connections.clear();
    this.#panels.clear();
    this.#layouts.clear();
    this.#background = null;
  }
}
