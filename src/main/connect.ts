import electron, { type IpcMainEvent, type WebContents, type WebContentsView } from "electron";
import type { IslandEvent, IslandEventType } from "../shared/nodes.js";
import {
  type BoundIsland,
  type BoundItem,
  type BoundRegion,
  Channel,
  type CommitMessage,
  type FramesMessage,
  type IslandFit,
} from "../shared/protocol.js";
import type { GroupOptions, Rect, Size } from "../shared/types.js";
import type { GlassHost } from "./host.js";
import type { GlassIsland } from "./island.js";
import type { GlassGroup, GlassRegion } from "./objects.js";
import { getCapabilities } from "./support.js";
import { parseCommand, parseCommit, parseFrames } from "./validate.js";

export interface ConnectOptions {
  /** Called when a message from the page is rejected. @default console.warn */
  onError?: (error: Error) => void;
}

interface RegionEntry {
  kind: "region";
  object: GlassRegion;
  /** Where the page put it, in the page's CSS pixels. */
  rect: Rect;
  signature: string;
  group: string | undefined;
  unstable: boolean;
}

interface IslandEntry {
  kind: "island";
  object: GlassIsland;
  rect: Rect;
  signature: string;
  content: string;
  fit: IslandFit;
  /** The size the island last asked for, in window points. */
  wanted: Size | undefined;
}

type Entry = RegionEntry | IslandEntry;

const ISLAND_EVENTS: readonly IslandEventType[] = ["press", "change", "submit", "focus", "blur", "resize"];

const connections = new Map<number, Connection>();
let routed = false;

/** One set of IPC listeners serves every connected page, dispatching on the sender. */
export function route(): void {
  if (routed) return;
  routed = true;
  // The default import keeps this module loadable outside Electron, where the named export does not exist.
  const { ipcMain } = electron;
  const forward = (channel: string, deliver: (connection: Connection, payload: unknown) => void): void => {
    ipcMain.on(channel, (event: IpcMainEvent, payload: unknown) => {
      // Only the top-level page of a connected window may place glass.
      if (event.senderFrame !== event.sender.mainFrame) return;
      const connection = connections.get(event.sender.id);
      if (connection) connection.guard(() => deliver(connection, payload));
    });
  };
  forward(Channel.commit, (connection, payload) => connection.commit(parseCommit(payload)));
  forward(Channel.frames, (connection, payload) => connection.frames(parseFrames(payload)));
  forward(Channel.command, (connection, payload) => connection.command(payload));
  ipcMain.handle(Channel.capabilities, () => getCapabilities());
}

function isView(target: WebContents | WebContentsView): target is WebContentsView {
  return "webContents" in target;
}

/** Drops keys whose value is `undefined`, so they do not override defaults when spread. */
function definedOnly<Options extends object>(options: Options): Options {
  const defined = Object.entries(options).filter(([, value]) => value !== undefined);
  // Same keys minus the undefined ones, which the type already allows to be absent.
  return Object.fromEntries(defined) as Options;
}

/**
 * Mirrors the glass one page asks for into native objects.
 *
 * A connected page can place glass anywhere in its window, including over other web views,
 * so only pages the app trusts should be connected.
 */
export class Connection {
  readonly #host: GlassHost;
  readonly #contents: WebContents;
  readonly #contentsId: number;
  readonly #view: WebContentsView | null;
  readonly #onError: (error: Error) => void;
  readonly #onDispose: (connection: Connection) => void;
  readonly #entries = new Map<string, Entry>();
  readonly #groups = new Map<string, { object: GlassGroup; signature: string }>();

  constructor(
    host: GlassHost,
    target: WebContents | WebContentsView,
    options: ConnectOptions,
    onDispose: (connection: Connection) => void,
  ) {
    this.#host = host;
    this.#view = isView(target) ? target : null;
    this.#contents = isView(target) ? target.webContents : target;
    // Read once: `id` throws after the contents is destroyed, which is when dispose often runs.
    this.#contentsId = this.#contents.id;
    this.#onError = options.onError ?? ((error) => console.warn(error.message));
    this.#onDispose = onDispose;
    if (connections.has(this.#contentsId)) throw new Error("This page is already connected to a glass host.");

    route();
    connections.set(this.#contentsId, this);
    this.#contents.on("did-navigate", this.#clear);
    this.#contents.on("render-process-gone", this.#clear);
    this.#contents.once("destroyed", this.#dispose);
    this.#view?.on("bounds-changed", this.#reframe);
    // A page that committed before anyone was listening will not repeat itself unasked.
    this.#contents.send(Channel.resync);
  }

  /** Runs `work`, reporting a bad message instead of letting it take down the main process. */
  guard(work: () => void): void {
    try {
      work();
    } catch (error) {
      this.#onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  commit(message: CommitMessage): void {
    for (const [name, options] of Object.entries(message.groups)) this.#syncGroup(name, options);
    // Groups go before the items are read, so an item cannot join one that is on its way out.
    for (const [name, group] of this.#groups) {
      if (Object.hasOwn(message.groups, name)) continue;
      // The native group takes its regions with it, so their entries go too.
      for (const [key, entry] of this.#entries) {
        if (entry.kind === "region" && entry.group === name) this.#entries.delete(key);
      }
      group.object.remove();
      this.#groups.delete(name);
    }

    const wanted = new Set<string>();
    for (const item of message.items) {
      wanted.add(item.key);
      // One bad item must not stop the rest of the page's glass.
      this.guard(() => this.#syncItem(item));
    }
    for (const [name, entry] of this.#entries) {
      if (!wanted.has(name)) this.#drop(name, entry);
    }
  }

  frames(message: FramesMessage): void {
    for (const [name, x, y, width, height] of message) {
      const entry = this.#entries.get(name);
      if (!entry) continue;
      entry.rect = { x, y, width, height };
      entry.object.setFrame(this.#toWindow(entry.rect));
      if (entry.kind === "island") this.#offerSize(name, entry);
    }
  }

  command(payload: unknown): void {
    const command = parseCommand(payload);
    const entry = this.#entries.get(command.key);
    if (entry?.kind !== "island") return;
    if (command.type === "focus") entry.object.focus(command.node);
    else entry.object.setValue(command.node, command.value);
  }

  dispose(): void {
    this.#dispose();
  }

  readonly #dispose = (): void => {
    if (connections.get(this.#contentsId) !== this) return;
    connections.delete(this.#contentsId);
    this.#clear();
    this.#onDispose(this);
    if (this.#contents.isDestroyed()) return;
    this.#contents.off("did-navigate", this.#clear);
    this.#contents.off("render-process-gone", this.#clear);
    this.#contents.off("destroyed", this.#dispose);
    this.#view?.off("bounds-changed", this.#reframe);
  };

  // Also runs when a new document has committed: it starts from nothing and commits its own glass.
  readonly #clear = (): void => {
    for (const entry of this.#entries.values()) entry.object.remove();
    for (const group of this.#groups.values()) group.object.remove();
    this.#entries.clear();
    this.#groups.clear();
  };

  // A view that moves without resizing sends the page nothing to react to.
  readonly #reframe = (): void => {
    for (const entry of this.#entries.values()) entry.object.setFrame(this.#toWindow(entry.rect));
  };

  /** Page rectangles are CSS pixels in the page's viewport; glass is placed in window points. */
  #toWindow(rect: Rect): Rect {
    const zoom = this.#contents.getZoomFactor();
    const origin = this.#view?.getBounds() ?? { x: 0, y: 0 };
    return {
      x: origin.x + rect.x * zoom,
      y: origin.y + rect.y * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    };
  }

  #syncGroup(name: string, options: GroupOptions): void {
    const full: Required<GroupOptions> = { spacing: 0, zIndex: 0, ...definedOnly(options) };
    const signature = JSON.stringify(full);
    const existing = this.#groups.get(name);
    if (!existing) this.#groups.set(name, { object: this.#host.addGroup(full), signature });
    else if (existing.signature !== signature) {
      existing.object.update(full);
      existing.signature = signature;
    }
  }

  #syncItem(item: BoundItem): void {
    const existing = this.#entries.get(item.key);
    if (item.kind === "region") {
      // A region cannot move between groups; it is made again in the new one.
      const reusable = existing?.kind === "region" && existing.group === item.group ? existing : undefined;
      if (existing && !reusable) this.#drop(item.key, existing);
      if (item.group !== undefined && !this.#groups.has(item.group)) {
        throw new TypeError(`electron-glasskit: unknown group "${item.group}".`);
      }
      this.#syncRegion(item, reusable);
    } else {
      const reusable = existing?.kind === "island" ? existing : undefined;
      if (existing && !reusable) this.#drop(item.key, existing);
      this.#syncIsland(item, reusable);
    }
  }

  #drop(key: string, entry: Entry): void {
    entry.object.remove();
    this.#entries.delete(key);
  }

  #syncRegion(item: BoundRegion, existing: RegionEntry | undefined): void {
    const { unstable_variant, unstable_scrim, unstable_subdued, ...rest } = definedOnly(item.options);
    const unstable = unstable_variant !== undefined || unstable_scrim !== undefined || unstable_subdued !== undefined;
    // The page sends its whole intent each time, so a dropped option has to return to its default.
    const options = {
      cornerRadius: 0,
      style: "regular",
      tint: null,
      appearance: "auto",
      interactive: false,
      zIndex: 0,
      hidden: false,
      ...rest,
      passthrough: rest.passthrough ?? !rest.interactive,
      // Undocumented setters are only touched for pages that use them.
      ...(unstable || existing?.unstable
        ? {
            unstable_variant: unstable_variant ?? 0,
            unstable_scrim: unstable_scrim ?? false,
            unstable_subdued: unstable_subdued ?? false,
          }
        : {}),
    } satisfies BoundRegion["options"];
    const signature = JSON.stringify(options);
    const frame = this.#toWindow(item.rect);
    if (existing) {
      if (existing.signature !== signature) existing.object.update(options);
      existing.object.setFrame(frame);
      existing.rect = item.rect;
      existing.signature = signature;
      existing.unstable ||= unstable;
      return;
    }
    const group = item.group === undefined ? undefined : this.#groups.get(item.group)?.object;
    const object = (group ?? this.#host).addRegion({ ...options, frame });
    this.#entries.set(item.key, { kind: "region", object, rect: item.rect, signature, group: item.group, unstable });
  }

  #syncIsland(item: BoundIsland, existing: IslandEntry | undefined): void {
    const options = {
      fit: item.fit ?? "none",
      passthrough: item.passthrough ?? false,
      appearance: item.appearance ?? "auto",
      zIndex: item.zIndex ?? 0,
      hidden: item.hidden ?? false,
    } satisfies Partial<BoundIsland>;
    const signature = JSON.stringify(options);
    const content = JSON.stringify(item.content);
    const frame = this.#toWindow(item.rect);
    if (existing) {
      if (existing.content !== content) existing.object.setContent(item.content, { animation: item.animation });
      if (existing.signature !== signature) existing.object.update(options);
      existing.object.setFrame(frame);
      existing.rect = item.rect;
      existing.content = content;
      existing.signature = signature;
      // A size reported for the old fit says nothing about the new one.
      if (existing.fit !== options.fit) existing.wanted = undefined;
      existing.fit = options.fit;
      this.#offerSize(item.key, existing);
      return;
    }
    // The page owns the element's size, so it applies the wanted size itself.
    const object = this.#host.addIsland({ ...options, frame, content: item.content, autoResize: false });
    const entry: IslandEntry = {
      kind: "island",
      object,
      rect: item.rect,
      signature,
      content,
      fit: options.fit,
      wanted: undefined,
    };
    for (const type of ISLAND_EVENTS) {
      object.on(type, (event) => {
        if (event.type === "resize") entry.wanted = event.size;
        this.#send(item.key, event);
      });
    }
    this.#entries.set(item.key, entry);
  }

  /**
   * An element bound a second time (a remount, say) starts without a size on its fitted axes,
   * and the island will not report a size that has not changed. Tell the page again.
   */
  #offerSize(key: string, entry: IslandEntry): void {
    if (!entry.wanted || entry.fit === "none") return;
    const missingWidth = entry.fit !== "height" && entry.rect.width === 0;
    const missingHeight = entry.fit !== "width" && entry.rect.height === 0;
    if (missingWidth || missingHeight) this.#send(key, { type: "resize", size: entry.wanted });
  }

  #send(key: string, event: IslandEvent): void {
    if (this.#contents.isDestroyed()) return;
    // Sizes leave in the page's own units, the reverse of #toWindow.
    const zoom = this.#contents.getZoomFactor();
    const scaled: IslandEvent =
      event.type === "resize"
        ? { type: "resize", size: { width: event.size.width / zoom, height: event.size.height / zoom } }
        : event;
    this.#contents.send(Channel.event, { key, event: scaled });
  }
}
