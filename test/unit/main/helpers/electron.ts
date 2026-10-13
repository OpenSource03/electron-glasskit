import { EventEmitter } from "node:events";
import type {
  BaseWindow,
  BrowserWindowConstructorOptions,
  PreloadScriptRegistration,
  Rectangle,
  Session,
  WebContents,
  WebContentsView,
} from "electron";
import type { EventMessage } from "../../../../src/shared/protocol.js";
import type { Capabilities, Size } from "../../../../src/shared/types.js";

// This module is what `vi.mock("electron", () => import("./helpers/electron.js"))` serves:
// `ipcMain` and `BrowserWindow` are the two values the main-process code imports.

const DESTROYED = "Object has been destroyed";

/** A window as the code under test sees it. Like Electron, most calls throw once it is destroyed. */
export class FakeWindow extends EventEmitter {
  readonly handle: Buffer = Buffer.from("window-handle");
  readonly boundsSet: Rectangle[] = [];
  content: Rectangle = { x: 0, y: 0, width: 800, height: 600 };
  bounds: Rectangle = { x: 0, y: 0, width: 800, height: 600 };
  shownInactive = false;
  #destroyed = false;

  #alive(): void {
    if (this.#destroyed) throw new TypeError(DESTROYED);
  }

  getContentBounds(): Rectangle {
    this.#alive();
    return { ...this.content };
  }

  getBounds(): Rectangle {
    this.#alive();
    return { ...this.bounds };
  }

  setBounds(bounds: Rectangle): void {
    this.#alive();
    this.bounds = { ...bounds };
    this.boundsSet.push({ ...bounds });
  }

  getNativeWindowHandle(): Buffer {
    this.#alive();
    return this.handle;
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  showInactive(): void {
    this.#alive();
    this.shownInactive = true;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.emit("closed");
  }

  /** The user resizes the window. */
  resizeContent(size: Size): void {
    this.content = { ...this.content, ...size };
    this.emit("resize");
  }

  /** The user drags the window. */
  moveContent(x: number, y: number): void {
    this.content = { ...this.content, x, y };
    this.emit("move");
  }
}

export class FakeBrowserWindow extends FakeWindow {
  static readonly created: FakeBrowserWindow[] = [];
  readonly options: BrowserWindowConstructorOptions;

  constructor(options: BrowserWindowConstructorOptions = {}) {
    super();
    this.options = options;
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 800, height: options.height ?? 600 };
    this.content = { ...this.bounds };
    FakeBrowserWindow.created.push(this);
  }

  static latest(): FakeBrowserWindow {
    const window = FakeBrowserWindow.created.at(-1);
    if (!window) throw new Error("no BrowserWindow was created");
    return window;
  }
}

export interface FakeFrame {
  readonly name: string;
}

let nextContentsId = 1;

export class FakeWebContents extends EventEmitter {
  readonly mainFrame: FakeFrame = { name: "main" };
  readonly subFrame: FakeFrame = { name: "sub" };
  /** Everything sent to the page. `message` is undefined for channels without a payload. */
  readonly sent: Array<{ channel: string; message: EventMessage | undefined }> = [];
  zoom = 1;
  readonly #id: number = nextContentsId++;
  #destroyed = false;

  /** Like Electron, reading the id of destroyed contents throws. */
  get id(): number {
    if (this.#destroyed) throw new TypeError(DESTROYED);
    return this.#id;
  }

  getZoomFactor(): number {
    if (this.#destroyed) throw new TypeError(DESTROYED);
    return this.zoom;
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  send(channel: string, message?: EventMessage): void {
    if (this.#destroyed) throw new TypeError(DESTROYED);
    this.sent.push({ channel, message });
  }

  /** The payloads sent to the page on `channel`, in order. */
  messages(channel: string): EventMessage[] {
    return this.sent.flatMap((sent) => (sent.channel === channel && sent.message ? [sent.message] : []));
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.emit("destroyed");
  }

  /** The contents is gone but its "destroyed" event has not been delivered yet. */
  destroySilently(): void {
    this.#destroyed = true;
  }

  /** A main-frame navigation has begun; nothing has been replaced yet. */
  startNavigation(): void {
    this.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  }

  /** A main-frame navigation has committed: the old document is gone. */
  navigate(url = "https://example.test/next"): void {
    this.emit("did-navigate", {}, url);
  }

  crash(): void {
    this.emit("render-process-gone", {}, { reason: "crashed" });
  }
}

export class FakeView extends EventEmitter {
  readonly webContents: FakeWebContents = new FakeWebContents();
  bounds: Rectangle;

  constructor(bounds: Rectangle) {
    super();
    this.bounds = bounds;
  }

  getBounds(): Rectangle {
    return { ...this.bounds };
  }

  /** The app moves or resizes the view. */
  setBounds(bounds: Rectangle): void {
    this.bounds = { ...bounds };
    this.emit("bounds-changed");
  }
}

export class FakeSession {
  readonly registered: PreloadScriptRegistration[] = [];

  registerPreloadScript(script: PreloadScriptRegistration): string {
    this.registered.push(script);
    return `preload-${this.registered.length}`;
  }
}

export interface FakeIpcEvent {
  sender: FakeWebContents;
  senderFrame: FakeFrame | null;
}

// A page can send anything, so the payload really is unknown here.
type IpcListener = (event: FakeIpcEvent, payload: unknown) => void;

export class FakeIpcMain {
  readonly #listeners = new Map<string, IpcListener[]>();
  readonly #handlers = new Map<string, () => Capabilities>();

  on(channel: string, listener: IpcListener): this {
    this.#listeners.set(channel, [...(this.#listeners.get(channel) ?? []), listener]);
    return this;
  }

  handle(channel: string, handler: () => Capabilities): void {
    if (this.#handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    this.#handlers.set(channel, handler);
  }

  listenerCount(channel: string): number {
    return this.#listeners.get(channel)?.length ?? 0;
  }

  /** Delivers a message as if `frame` of `sender` had sent it. Defaults to the page's main frame. */
  deliver(
    channel: string,
    sender: FakeWebContents,
    payload: unknown,
    frame: FakeFrame | null = sender.mainFrame,
  ): void {
    for (const listener of this.#listeners.get(channel) ?? []) listener({ sender, senderFrame: frame }, payload);
  }

  invoke(channel: string): Capabilities {
    const handler = this.#handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for '${channel}'`);
    return handler();
  }
}

export const ipcMain: FakeIpcMain = new FakeIpcMain();
export const BrowserWindow: typeof FakeBrowserWindow = FakeBrowserWindow;

/** The code under test reaches Electron's values through the default export. */
const electron: { ipcMain: FakeIpcMain; BrowserWindow: typeof FakeBrowserWindow } = { ipcMain, BrowserWindow };
export default electron;

// The fakes implement only what the code under test calls, so each is cast once, here.
export function asWindow(window: FakeWindow): BaseWindow {
  return window as unknown as BaseWindow;
}

export function asContents(contents: FakeWebContents): WebContents {
  return contents as unknown as WebContents;
}

export function asView(view: FakeView): WebContentsView {
  return view as unknown as WebContentsView;
}

export function asSession(session: FakeSession): Session {
  return session as unknown as Session;
}
