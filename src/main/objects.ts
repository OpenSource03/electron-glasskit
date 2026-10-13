import type { BackgroundOptions, GlassMaterial, GroupOptions, Rect, RegionOptions } from "../shared/types.js";
import { normalizeColor } from "./color.js";
import type { HostContext } from "./context.js";
import { type FrameInput, resolveFrame } from "./geometry.js";

export type GlassRegionOptions = Omit<RegionOptions, "frame"> & { frame: FrameInput };
export type GlassRegionUpdate = Partial<GlassRegionOptions>;

export interface SetFrameOptions {
  /** Animate the move. `true` takes 0.25 s; a number is the duration in seconds. @default false */
  animate?: boolean | number;
}

const DEFAULT_ANIMATION_SECONDS = 0.25;

function encodeMaterial(material: GlassMaterial): GlassMaterial {
  return {
    style: material.style,
    tint: material.tint == null ? material.tint : normalizeColor(material.tint),
    appearance: material.appearance,
    unstable_variant: material.unstable_variant,
    unstable_scrim: material.unstable_scrim,
    unstable_subdued: material.unstable_subdued,
  };
}

/** Something this library added to a window. Calls made after `remove()` do nothing. */
export abstract class GlassObject {
  readonly #context: HostContext;
  readonly #id: number;
  #removed = false;

  /** @internal */
  constructor(context: HostContext, id: number) {
    this.#context = context;
    this.#id = id;
  }

  /** @internal */
  protected get context(): HostContext {
    return this.#context;
  }

  /** The native object's id, or 0 where glass is unavailable. */
  get id(): number {
    return this.#id;
  }

  get isRemoved(): boolean {
    return this.#removed;
  }

  remove(): void {
    if (this.#removed) return;
    this.#removed = true;
    this.#context.native.objectRemove(this.#id);
    this.#context.release(this);
    this.onRemove();
  }

  /** @internal */
  protected onRemove(): void {}
}

/** A {@link GlassObject} with a frame, which may follow the window's size. */
export abstract class PlacedGlassObject extends GlassObject {
  #input: FrameInput;
  #frame: Rect;
  #stopLayout: (() => void) | undefined;

  /** @internal */
  constructor(context: HostContext, id: number, input: FrameInput, frame: Rect) {
    super(context, id);
    this.#input = input;
    this.#frame = frame;
    this.#follow();
  }

  /** The frame last applied, in window content coordinates. */
  get frame(): Rect {
    return { ...this.#frame };
  }

  setFrame(frame: FrameInput, options: SetFrameOptions = {}): this {
    if (this.isRemoved) return this;
    // Resolved before anything is stored, so a rejected frame leaves the old one in charge.
    const resolved = resolveFrame(frame, this.context.contentSize());
    this.#input = frame;
    this.#follow();
    this.#apply(resolved, options.animate === true ? DEFAULT_ANIMATION_SECONDS : options.animate || 0);
    return this;
  }

  /** @internal Lets a subclass adjust the resolved frame before it is applied. */
  protected adjustFrame(frame: Rect): Rect {
    return frame;
  }

  /** @internal Applies the current frame again, after the window or the subclass's adjustment changed. */
  protected relayout(): void {
    if (!this.isRemoved) this.#apply(resolveFrame(this.#input, this.context.contentSize()), 0);
  }

  #apply(resolved: Rect, seconds: number): void {
    const frame = this.adjustFrame(resolved);
    this.#frame = frame;
    this.context.native.objectSetFrame(this.id, frame.x, frame.y, frame.width, frame.height, seconds);
  }

  // Only function frames depend on the window size.
  #follow(): void {
    this.#stopLayout?.();
    this.#stopLayout = typeof this.#input === "function" ? this.context.onLayout(() => this.relayout()) : undefined;
  }

  protected override onRemove(): void {
    this.#stopLayout?.();
  }
}

function encodeRegion(options: GlassRegionUpdate, frame: Rect | undefined): string {
  return JSON.stringify({
    frame,
    cornerRadius: options.cornerRadius,
    interactive: options.interactive,
    passthrough: options.passthrough,
    zIndex: options.zIndex,
    hidden: options.hidden,
    ...encodeMaterial(options),
  });
}

/** One piece of Liquid Glass floating over the page. */
export class GlassRegion extends PlacedGlassObject {
  /** @internal */
  static create(context: HostContext, options: GlassRegionOptions, groupId = 0): GlassRegion {
    const frame = resolveFrame(options.frame, context.contentSize());
    const id = context.native.regionCreate(context.handle(), groupId, encodeRegion(options, frame));
    return new GlassRegion(context, id, options.frame, frame);
  }

  update(options: GlassRegionUpdate): this {
    if (this.isRemoved) return this;
    const { frame, ...rest } = options;
    this.context.native.objectUpdate(this.id, encodeRegion(rest, undefined));
    if (frame !== undefined) this.setFrame(frame);
    return this;
  }
}

/** Regions in a group flow into each other when they come close, like drops of liquid. */
export class GlassGroup extends GlassObject {
  readonly #regions = new Set<{ remove(): void }>();
  readonly #memberContext: HostContext = { ...this.context, release: (region) => this.#regions.delete(region) };

  /** @internal */
  static create(context: HostContext, options: GroupOptions): GlassGroup {
    const id = context.native.groupCreate(
      context.handle(),
      JSON.stringify({ spacing: options.spacing, zIndex: options.zIndex }),
    );
    return new GlassGroup(context, id);
  }

  addRegion(options: GlassRegionOptions): GlassRegion {
    if (this.isRemoved) throw new Error("This glass group has been removed.");
    const region = GlassRegion.create(this.#memberContext, options, this.id);
    this.#regions.add(region);
    return region;
  }

  update(options: GroupOptions): this {
    if (!this.isRemoved) {
      this.context.native.objectUpdate(this.id, JSON.stringify({ spacing: options.spacing, zIndex: options.zIndex }));
    }
    return this;
  }

  // The native group takes its regions with it; mark the handles to match.
  protected override onRemove(): void {
    for (const region of [...this.#regions]) region.remove();
  }
}

function encodeBackground(options: BackgroundOptions): string {
  return JSON.stringify({
    cornerRadius: options.cornerRadius,
    opaque: options.opaque,
    fallbackMaterial: options.fallbackMaterial,
    ...encodeMaterial(options),
  });
}

/** The sheet of glass behind the whole page. */
export class GlassBackground extends GlassObject {
  /** @internal */
  static create(context: HostContext, options: BackgroundOptions): GlassBackground {
    return new GlassBackground(context, context.native.backgroundSet(context.handle(), encodeBackground(options)));
  }

  update(options: BackgroundOptions): this {
    if (!this.isRemoved) this.context.native.objectUpdate(this.id, encodeBackground(options));
    return this;
  }
}
