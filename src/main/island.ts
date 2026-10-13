import type {
  Alignment,
  GlassNode,
  IslandAnimation,
  IslandEvent,
  IslandEventOf,
  IslandEventType,
  NodeValue,
} from "../shared/nodes.js";
import type { IslandFit } from "../shared/protocol.js";
import type { GlassAppearance, Rect, Size } from "../shared/types.js";
import type { HostContext } from "./context.js";
import { type FrameInput, fitFrame, resolveFrame } from "./geometry.js";
import { prepareContent } from "./nodes.js";
import { PlacedGlassObject } from "./objects.js";

export interface GlassIslandOptions {
  frame: FrameInput;
  /** The native view tree to render. */
  content: GlassNode;
  /**
   * Let the content choose its own size on these axes. The wanted size arrives as `resize` events.
   * @default "none"
   */
  fit?: IslandFit;
  /**
   * Resize the island to the size its content asks for, on the axes named by `fit`.
   * `anchor` is the point of the frame that stays put.
   * @default true, anchored at "topLeading"
   */
  autoResize?: boolean | { anchor?: Alignment };
  /** Never take clicks; the page underneath gets them. @default false */
  passthrough?: boolean;
  /** @default "auto" */
  appearance?: GlassAppearance;
  /** @default 0 */
  zIndex?: number;
  /** @default false */
  hidden?: boolean;
}

export type GlassIslandUpdate = Partial<Omit<GlassIslandOptions, "content">>;

export interface SetContentOptions {
  /** How the island moves from the old tree to the new one. @default "none" */
  animation?: IslandAnimation;
}

export type GlassIslandListener<Type extends IslandEventType> = (event: IslandEventOf<Type>) => void;

type Listeners = { [Type in IslandEventType]: Set<GlassIslandListener<Type>> };

function deliver<Type extends IslandEventType>(listeners: Listeners, type: Type, event: IslandEventOf<Type>): void {
  for (const listener of [...listeners[type]]) listener(event);
}

function encodeOptions(options: GlassIslandUpdate, frame: Rect | undefined, content?: GlassNode): string {
  return JSON.stringify({
    frame,
    content,
    fit: options.fit,
    passthrough: options.passthrough,
    appearance: options.appearance,
    zIndex: options.zIndex,
    hidden: options.hidden,
  });
}

/** A native SwiftUI view tree, on real glass, floating over the page. */
export class GlassIsland extends PlacedGlassObject {
  readonly #listeners: Listeners = {
    press: new Set(),
    change: new Set(),
    submit: new Set(),
    focus: new Set(),
    blur: new Set(),
    resize: new Set(),
  };
  #fit: IslandFit;
  #anchor: Alignment | null;
  #wanted: Size | undefined;
  #stopEvents: () => void;

  /** @internal */
  static create(context: HostContext, options: GlassIslandOptions): GlassIsland {
    const frame = resolveFrame(options.frame, context.contentSize());
    const id = context.native.islandCreate(
      context.handle(),
      encodeOptions(options, frame, prepareContent(options.content)),
    );
    return new GlassIsland(context, id, options, frame);
  }

  private constructor(context: HostContext, id: number, options: GlassIslandOptions, frame: Rect) {
    super(context, id, options.frame, frame);
    this.#fit = options.fit ?? "none";
    this.#anchor = GlassIsland.#anchorOf(options.autoResize);
    this.#stopEvents = context.onEvent(id, (event) => this.#dispatch(event));
  }

  static #anchorOf(autoResize: GlassIslandOptions["autoResize"]): Alignment | null {
    if (autoResize === false) return null;
    return (typeof autoResize === "object" ? autoResize.anchor : undefined) ?? "topLeading";
  }

  setContent(content: GlassNode, options: SetContentOptions = {}): this {
    if (this.isRemoved) return this;
    const animation = options.animation === undefined ? null : JSON.stringify(options.animation);
    this.context.native.islandSetContent(this.id, JSON.stringify(prepareContent(content)), animation);
    return this;
  }

  update(options: GlassIslandUpdate): this {
    if (this.isRemoved) return this;
    const { frame, autoResize, ...rest } = options;
    if (rest.fit !== undefined && rest.fit !== this.#fit) {
      this.#fit = rest.fit;
      this.#wanted = undefined;
    }
    if (autoResize !== undefined) this.#anchor = GlassIsland.#anchorOf(autoResize);
    this.context.native.objectUpdate(this.id, encodeOptions(rest, undefined));
    if (frame !== undefined) this.setFrame(frame);
    else this.relayout();
    return this;
  }

  /** Sets a control's value. Returns false when the island has no control with that id. */
  setValue(node: string, value: NodeValue): boolean {
    return !this.isRemoved && this.context.native.islandSetValue(this.id, node, JSON.stringify(value));
  }

  /** Moves keyboard focus to a text field. Returns false when there is no such field. */
  focus(node: string): boolean {
    return !this.isRemoved && this.context.native.islandFocus(this.id, node);
  }

  /**
   * Subscribes to one kind of event. Returns the function that unsubscribes.
   * A `resize` has already been applied to the frame when `autoResize` is on.
   */
  on<Type extends IslandEventType>(type: Type, listener: GlassIslandListener<Type>): () => void {
    const listeners: Set<GlassIslandListener<Type>> = this.#listeners[type];
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  protected override adjustFrame(frame: Rect): Rect {
    if (!this.#wanted || !this.#anchor || this.#fit === "none") return frame;
    return fitFrame(frame, this.#wanted, this.#fit, this.#anchor);
  }

  #dispatch(event: IslandEvent): void {
    switch (event.type) {
      case "press":
        deliver(this.#listeners, "press", event);
        break;
      case "change":
        deliver(this.#listeners, "change", event);
        break;
      case "submit":
        deliver(this.#listeners, "submit", event);
        break;
      case "focus":
        deliver(this.#listeners, "focus", event);
        break;
      case "blur":
        deliver(this.#listeners, "blur", event);
        break;
      case "resize":
        this.#wanted = event.size;
        this.relayout();
        deliver(this.#listeners, "resize", event);
        break;
    }
  }

  protected override onRemove(): void {
    super.onRemove();
    this.#stopEvents();
    for (const listeners of Object.values(this.#listeners)) listeners.clear();
  }
}
