import electron, {
  type BaseWindow,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from "electron";
import type { BackgroundOptions, Rect } from "../shared/types.js";
import { type FrameInput, resolveFrame } from "./geometry.js";
import type { GlassHost } from "./host.js";
import type { GlassBackground } from "./objects.js";

export interface GlassPanelOptions extends BackgroundOptions {
  /** Where the panel sits, in the parent window's content coordinates. */
  frame: FrameInput;
  /** Show the panel as soon as it is created, without taking focus. @default true */
  show?: boolean;
  /** Extra options for the panel's window, such as `webPreferences`. */
  window?: BrowserWindowConstructorOptions;
}

/**
 * A see-through child window with a glass sheet behind its page.
 *
 * Web content always ends up underneath native glass in the same window, so this is how
 * HTML gets to sit on top of glass that still bends the parent page behind it.
 */
export class GlassPanel {
  readonly window: BrowserWindow;
  readonly #parent: BaseWindow;
  readonly #background: GlassBackground;
  #input: FrameInput;
  #frame: Rect = { x: 0, y: 0, width: 0, height: 0 };
  #closed = false;

  /** @internal */
  static create(parent: BaseWindow, options: GlassPanelOptions, attach: (window: BaseWindow) => GlassHost): GlassPanel {
    return new GlassPanel(parent, options, attach);
  }

  private constructor(parent: BaseWindow, options: GlassPanelOptions, attach: (window: BaseWindow) => GlassHost) {
    const { frame, show = true, window: windowOptions, ...background } = options;
    this.#parent = parent;
    this.#input = frame;
    // The default import keeps this module loadable outside Electron, where the named export does not exist.
    this.window = new electron.BrowserWindow({
      ...windowOptions,
      ...this.#bounds(),
      parent,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
    });
    try {
      this.#background = attach(this.window).setBackground(background);
    } catch (error) {
      this.window.destroy();
      throw error;
    }

    // macOS moves child windows with their parent; other platforms need both events.
    parent.on("resize", this.#reposition);
    parent.on("move", this.#reposition);
    this.window.once("closed", () => this.#release());
    if (show) this.window.showInactive();
  }

  /** The frame last applied, in the parent window's content coordinates. */
  get frame(): Rect {
    return { ...this.#frame };
  }

  setFrame(frame: FrameInput): this {
    if (this.#closed || this.#parent.isDestroyed()) return this;
    // Resolved before it is stored, so a rejected frame leaves the old one in charge.
    resolveFrame(frame, this.#parent.getContentBounds());
    this.#input = frame;
    this.#reposition();
    return this;
  }

  /** Changes the look of the glass behind the panel's page. */
  update(options: BackgroundOptions): this {
    this.#background.update(options);
    return this;
  }

  close(): void {
    if (!this.#closed) this.window.destroy();
  }

  #bounds(): Rectangle {
    const content = this.#parent.getContentBounds();
    const frame = resolveFrame(this.#input, content);
    this.#frame = frame;
    return {
      x: Math.round(content.x + frame.x),
      y: Math.round(content.y + frame.y),
      width: Math.round(frame.width),
      height: Math.round(frame.height),
    };
  }

  readonly #reposition = (): void => {
    if (!this.#closed && !this.#parent.isDestroyed()) this.window.setBounds(this.#bounds());
  };

  #release(): void {
    this.#closed = true;
    if (this.#parent.isDestroyed()) return;
    this.#parent.off("resize", this.#reposition);
    this.#parent.off("move", this.#reposition);
  }
}
