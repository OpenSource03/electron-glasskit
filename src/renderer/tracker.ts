import type { IslandEvent } from "../shared/nodes.js";
import type {
  BoundIsland,
  BoundItem,
  BoundRegion,
  EventMessage,
  FramesMessage,
  GlasskitBridge,
  IslandCommand,
  IslandFit,
} from "../shared/protocol.js";
import type { GroupOptions, Rect } from "../shared/types.js";
import { getBridge } from "./bridge.js";
import { measure, sameRect } from "./measure.js";
import type { Tracking } from "./types.js";

/** A bound item without its geometry, which the tracker owns. */
export type Unplaced = Omit<BoundRegion, "rect"> | Omit<BoundIsland, "rect">;

/** What a binding gives the tracker. The mutable fields are read on every flush. */
export interface Source {
  readonly key: string;
  readonly element: HTMLElement;
  tracking: Tracking;
  /** Axes sized by native content, where a collapsed element is still shown. */
  fit: IslandFit;
  /** Describes the item, adding the group it merges within to `groups`. */
  describe(hidden: boolean, groups: Record<string, GroupOptions>): Unplaced;
  onEvent?(event: IslandEvent): void;
}

interface Entry {
  source: Source;
  rect: Rect;
  hidden: boolean;
  moved: boolean;
}

interface Session {
  observer: ResizeObserver;
  unsubscribe: Array<() => void>;
}

const NOTHING = "[[],{}]";

const entries = new Map<string, Entry>();
let session: Session | null = null;
let committed = NOTHING;
let commands: IslandCommand[] = [];
let scheduled = false;
let looping = false;
let dirty = false;
let measureAll = false;
let pixelRatio = 0;

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // Animation frames stop in a hidden window, and glass should be in place before it is shown.
  const run = (): void => {
    scheduled = false;
    flush();
  };
  if (document.visibilityState === "hidden") setTimeout(run, 0);
  else requestAnimationFrame(run);
}

/** Per-frame tracking has its own flag: a frame that never comes in a hidden window must not block `schedule`. */
function loop(): void {
  if (looping) return;
  looping = true;
  requestAnimationFrame(() => {
    looping = false;
    flush();
  });
}

function requestMeasure(): void {
  measureAll = true;
  schedule();
}

function dispatch(message: EventMessage): void {
  entries.get(message.key)?.source.onEvent?.(message.event);
}

/** The main process lost, or never had, what was committed: send all of it again. */
function resync(): void {
  committed = "";
  dirty = true;
  requestMeasure();
}

function start(bridge: GlasskitBridge): Session {
  document.addEventListener("scroll", requestMeasure, { capture: true, passive: true });
  window.addEventListener("resize", requestMeasure);
  return {
    observer: new ResizeObserver(requestMeasure),
    unsubscribe: [bridge.onEvent(dispatch), bridge.onResync(resync)],
  };
}

function stop(running: Session): void {
  document.removeEventListener("scroll", requestMeasure, { capture: true });
  window.removeEventListener("resize", requestMeasure);
  running.observer.disconnect();
  for (const unsubscribe of running.unsubscribe) unsubscribe();
}

function remeasure(entry: Entry): void {
  const rect = measure(entry.source.element, entry.source.fit);
  const hidden = rect === null;
  if (hidden !== entry.hidden) {
    entry.hidden = hidden;
    dirty = true;
  }
  // A hidden item keeps its last rect, so it reappears in place.
  if (rect && !sameRect(rect, entry.rect)) {
    entry.rect = rect;
    entry.moved = true;
  }
}

/** Sends the complete set when anything but geometry differs from the last commit. */
function commit(bridge: GlasskitBridge): boolean {
  const groups: Record<string, GroupOptions> = {};
  const unplaced: Unplaced[] = [];
  const items: BoundItem[] = [];
  for (const entry of entries.values()) {
    const item = entry.source.describe(entry.hidden, groups);
    unplaced.push(item);
    items.push({ ...item, rect: entry.rect });
  }
  const signature = JSON.stringify([unplaced, groups]);
  if (signature === committed) return false;
  bridge.commit({ items, groups });
  // Recorded only once sent, so a commit that threw is tried again with the next change.
  committed = signature;
  return true;
}

function flush(): void {
  const bridge = getBridge();
  if (!bridge) return;

  const all = measureAll;
  measureAll = false;
  let everyFrame = false;
  for (const entry of entries.values()) {
    const frame = entry.source.tracking === "frame";
    everyFrame ||= frame;
    if (all || frame) remeasure(entry);
  }

  // Page zoom changes how CSS pixels map onto the window, even for rectangles that did not change.
  if (window.devicePixelRatio !== pixelRatio) {
    pixelRatio = window.devicePixelRatio;
    for (const entry of entries.values()) entry.moved = true;
  }

  const changed = dirty;
  dirty = false;
  try {
    // A commit carries every rect, so it replaces this frame's geometry message.
    if (!(changed && commit(bridge))) {
      const frames: FramesMessage = [];
      for (const { source, rect, hidden, moved } of entries.values()) {
        if (moved && !hidden) frames.push([source.key, rect.x, rect.y, rect.width, rect.height]);
      }
      if (frames.length > 0) bridge.frames(frames);
    }
    for (const command of commands) bridge.command(command);
  } finally {
    // A send throws on a value that cannot be cloned; later flushes must still run.
    for (const entry of entries.values()) entry.moved = false;
    commands = [];
    if (everyFrame) loop();
  }
}

/** Starts mirroring `source`. Replaces an earlier source with the same key. */
export function track(source: Source): void {
  const bridge = getBridge();
  if (!bridge) return;
  session ??= start(bridge);
  entries.set(source.key, { source, rect: { x: 0, y: 0, width: 0, height: 0 }, hidden: true, moved: false });
  session.observer.observe(source.element);
  dirty = true;
  requestMeasure();
}

export function untrack(source: Source): void {
  if (entries.get(source.key)?.source !== source || !session) return;
  entries.delete(source.key);
  // A region and an island can share an element, which stays observed while either is bound.
  const shared = [...entries.values()].some((entry) => entry.source.element === source.element);
  if (!shared) session.observer.unobserve(source.element);
  if (entries.size === 0) {
    stop(session);
    session = null;
  }
  // The frame that is left sends the commit that removes the item.
  dirty = true;
  schedule();
}

/** Options or content of some source changed: re-describe and re-measure on the next frame. */
export function invalidate(): void {
  if (!session) return;
  dirty = true;
  requestMeasure();
}

/**
 * Re-measures every bound element on the next frame. Call it after a layout change
 * that `auto` tracking cannot see, such as an element pushed by a sibling.
 */
export function refresh(): void {
  if (session) requestMeasure();
}

/** Sends a command to a tracked island, after any commit that is still pending. */
export function sendCommand(source: Source, command: IslandCommand): void {
  if (entries.get(source.key)?.source !== source) return;
  if (dirty) commands.push(command);
  else getBridge()?.command(command);
}
