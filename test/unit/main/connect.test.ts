import type { Rectangle } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachGlass } from "../../../src/main/host.js";
import { setNative } from "../../../src/main/native.js";
import { type GlassNode, type IslandEvent, ui } from "../../../src/shared/nodes.js";
import {
  type BoundIsland,
  type BoundRegion,
  Channel,
  type CommitMessage,
  type EventMessage,
} from "../../../src/shared/protocol.js";
import type { GroupOptions, Rect } from "../../../src/shared/types.js";
import { asContents, asView, asWindow, FakeView, FakeWebContents, FakeWindow, ipcMain } from "./helpers/electron.js";
import { decode, GLASS_CAPABILITIES, type Json } from "./helpers/native.js";
import { type Stage, stage } from "./helpers/stage.js";

vi.mock("electron", () => import("./helpers/electron.js"));

afterEach(() => {
  setNative(undefined);
});

const RECT = { x: 10, y: 20, width: 30, height: 40 };
const TEXT = ui.text("Hello");

/** What a region is created with when the page gives no options. */
const REGION_DEFAULTS = {
  cornerRadius: 0,
  style: "regular",
  tint: null,
  appearance: "auto",
  interactive: false,
  zIndex: 0,
  hidden: false,
  passthrough: true,
};

const ISLAND_DEFAULTS = { fit: "none", passthrough: false, appearance: "auto", zIndex: 0, hidden: false };

function region(key: string, overrides: Partial<BoundRegion> = {}): BoundRegion {
  return { kind: "region", key, rect: RECT, options: {}, ...overrides };
}

function island(key: string, overrides: Partial<BoundIsland> = {}): BoundIsland {
  return { kind: "island", key, rect: RECT, content: TEXT, ...overrides };
}

function message(items: Array<BoundRegion | BoundIsland>, groups: Record<string, GroupOptions> = {}): CommitMessage {
  return { items, groups };
}

interface Page extends Stage {
  contents: FakeWebContents;
  /** The view the page was connected through, when there is one. */
  view: FakeView | undefined;
  /** The island events sent to the page so far. */
  events(): EventMessage[];
  /** Everything `onError` was called with. */
  errors: Error[];
  disconnect: () => void;
  commit(items: Array<BoundRegion | BoundIsland>, groups?: Record<string, GroupOptions>): void;
  /** Native calls made while `work` runs, by method name. */
  during(work: () => void): string[];
}

/** A page connected to a host, either directly or through a view placed at `viewBounds`. */
function connect(viewBounds?: Rectangle): Page {
  const staged = stage();
  const view = viewBounds ? new FakeView(viewBounds) : undefined;
  const contents = view?.webContents ?? new FakeWebContents();
  const errors: Error[] = [];
  const disconnect = staged.host.connect(view ? asView(view) : asContents(contents), {
    onError: (error) => errors.push(error),
  });
  return {
    ...staged,
    contents,
    view,
    events: () => contents.messages(Channel.event),
    errors,
    disconnect,
    commit: (items, groups) => ipcMain.deliver(Channel.commit, contents, message(items, groups)),
    during: (work) => {
      const before = staged.native.log.length;
      work();
      return staged.native.log.slice(before);
    },
  };
}

/** The decoded options of the `index`th region the addon was asked to create. */
function createdRegion(page: Page, index = 0): { groupId: number | undefined; options: Json } {
  const [, groupId, options] = page.native.calls.regionCreate[index] ?? [];
  return { groupId, options: decode(options ?? "null") };
}

function createdIsland(page: Page, index = 0): Json {
  return decode(page.native.calls.islandCreate[index]?.[1] ?? "null");
}

function frame(rect: Rect): [number, number, number, number, number] {
  return [rect.x, rect.y, rect.width, rect.height, 0];
}

describe("a page's first commit", () => {
  it("creates a region with every option at its default", () => {
    const page = connect();
    page.commit([region("a")]);
    expect(createdRegion(page)).toStrictEqual({ groupId: 0, options: { frame: RECT, ...REGION_DEFAULTS } });
  });

  it("creates a region with the options the page gave", () => {
    const page = connect();
    const options = { cornerRadius: 12, style: "clear", appearance: "dark", zIndex: 4, hidden: true } as const;
    page.commit([region("a", { options: { ...options, tint: "#f00" } })]);
    expect(createdRegion(page).options).toStrictEqual({
      frame: RECT,
      ...REGION_DEFAULTS,
      ...options,
      tint: "#FF0000FF",
    });
  });

  it("stops an interactive region passing clicks through", () => {
    const page = connect();
    page.commit([region("a", { options: { interactive: true } })]);
    expect(createdRegion(page).options).toMatchObject({ interactive: true, passthrough: false });
  });

  it("lets the page decide passthrough for an interactive region", () => {
    const page = connect();
    page.commit([region("a", { options: { interactive: true, passthrough: true } })]);
    expect(createdRegion(page).options).toMatchObject({ interactive: true, passthrough: true });
  });

  it("creates a group with its options at their defaults", () => {
    const page = connect();
    page.commit([], { g: {} });
    expect(decode(page.native.calls.groupCreate[0]?.[1] ?? "")).toStrictEqual({ spacing: 0, zIndex: 0 });
  });

  it("creates a group with the options the page gave", () => {
    const page = connect();
    page.commit([], { g: { spacing: 24, zIndex: 2 } });
    expect(decode(page.native.calls.groupCreate[0]?.[1] ?? "")).toStrictEqual({ spacing: 24, zIndex: 2 });
  });

  it("creates a grouped region inside its group", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    expect(createdRegion(page).groupId).toBe(page.native.lastId - 1);
  });

  it("creates an island with every option at its default", () => {
    const page = connect();
    page.commit([island("i")]);
    expect(createdIsland(page)).toStrictEqual({
      frame: RECT,
      content: { type: "text", text: "Hello" },
      ...ISLAND_DEFAULTS,
    });
  });

  it("creates an island with the options the page gave", () => {
    const page = connect();
    const options = { fit: "both", passthrough: true, appearance: "light", zIndex: 3, hidden: true } as const;
    page.commit([island("i", options)]);
    expect(createdIsland(page)).toMatchObject(options);
  });

  it("normalises the colours in an island's content", () => {
    const page = connect();
    page.commit([island("i", { content: ui.text("Hello", { foreground: "#0f0" }) })]);
    expect(createdIsland(page)).toMatchObject({ content: { foreground: "#00FF00FF" } });
  });

  it("leaves an island's size to the page, which owns the element", () => {
    const page = connect();
    page.commit([island("i", { fit: "both" })]);
    page.native.emit(page.native.lastId, { type: "resize", size: { width: 5, height: 5 } });
    expect(page.native.framesOf(page.native.lastId)).toStrictEqual([frame(RECT)]);
  });

  it("creates everything in one commit", () => {
    const page = connect();
    page.commit([region("a"), region("b", { group: "g" }), island("i")], { g: {} });
    const { calls } = page.native;
    expect([calls.groupCreate.length, calls.regionCreate.length, calls.islandCreate.length]).toStrictEqual([1, 2, 1]);
    expect(page.errors).toStrictEqual([]);
  });
});

describe("page to window coordinates", () => {
  it("uses the page's rectangle unchanged at zoom 1 in a page that fills the window", () => {
    const page = connect();
    page.commit([region("a")]);
    expect(createdRegion(page).options).toMatchObject({ frame: RECT });
  });

  it("scales the rectangle by the page's zoom factor", () => {
    const page = connect();
    page.contents.zoom = 2;
    page.commit([region("a")]);
    expect(createdRegion(page).options).toMatchObject({ frame: { x: 20, y: 40, width: 60, height: 80 } });
  });

  it("adds the offset of a WebContentsView", () => {
    const page = connect({ x: 200, y: 100, width: 400, height: 300 });
    page.commit([region("a")]);
    expect(createdRegion(page).options).toMatchObject({ frame: { x: 210, y: 120, width: 30, height: 40 } });
  });

  it("scales by the zoom factor before adding the view's offset", () => {
    const page = connect({ x: 200, y: 100, width: 400, height: 300 });
    page.contents.zoom = 1.5;
    page.commit([island("i")]);
    expect(createdIsland(page)).toMatchObject({ frame: { x: 215, y: 130, width: 45, height: 60 } });
  });

  it("converts the rectangles of a frames message the same way", () => {
    const page = connect({ x: 200, y: 100, width: 400, height: 300 });
    page.contents.zoom = 2;
    page.commit([region("a")]);
    ipcMain.deliver(Channel.frames, page.contents, [["a", 1, 2, 3, 4]]);
    expect(page.native.framesOf(page.native.lastId)).toStrictEqual([[202, 104, 6, 8, 0]]);
  });
});

describe("a repeated commit", () => {
  it("only re-applies the frames when nothing changed", () => {
    const page = connect();
    const items = [
      region("a", { options: { tint: "#f00" } }),
      region("b", { group: "g" }),
      island("i", { fit: "width" }),
    ];
    page.commit(items, { g: { spacing: 8 } });
    expect(page.during(() => page.commit(items, { g: { spacing: 8 } }))).toStrictEqual([
      "objectSetFrame",
      "objectSetFrame",
      "objectSetFrame",
    ]);
  });

  it("moves an item whose rectangle changed", () => {
    const page = connect();
    page.commit([region("a")]);
    const moved = { x: 1, y: 2, width: 3, height: 4 };
    page.commit([region("a", { rect: moved })]);
    expect(page.native.framesOf(page.native.lastId)).toStrictEqual([frame(moved)]);
  });

  it("sends a region's whole intent when one option changed", () => {
    const page = connect();
    page.commit([region("a", { options: { cornerRadius: 8 } })]);
    page.commit([region("a", { options: { cornerRadius: 8, zIndex: 2 } })]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([
      { ...REGION_DEFAULTS, cornerRadius: 8, zIndex: 2 },
    ]);
  });

  it("returns an option the page dropped to its default", () => {
    const page = connect();
    page.commit([region("a", { options: { tint: "#f00", cornerRadius: 12, interactive: true, hidden: true } })]);
    page.commit([region("a")]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([REGION_DEFAULTS]);
  });

  it("treats an option given as undefined like one that was dropped", () => {
    const page = connect();
    page.commit([region("a", { options: { cornerRadius: 12 } })]);
    page.commit([region("a", { options: { cornerRadius: undefined } })]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([REGION_DEFAULTS]);
  });

  it("updates a group whose options changed", () => {
    const page = connect();
    page.commit([], { g: { spacing: 8 } });
    page.commit([], { g: { spacing: 16, zIndex: 1 } });
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([{ spacing: 16, zIndex: 1 }]);
  });

  it("returns a group option the page dropped to its default", () => {
    const page = connect();
    page.commit([], { g: { spacing: 8 } });
    page.commit([], { g: {} });
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([{ spacing: 0, zIndex: 0 }]);
  });

  it("does not touch a group whose options are the same", () => {
    const page = connect();
    page.commit([], { g: { spacing: 8 } });
    expect(page.during(() => page.commit([], { g: { spacing: 8 } }))).toStrictEqual([]);
  });

  it("sends an island's options when one changed, with the rest at their defaults", () => {
    const page = connect();
    page.commit([island("i", { zIndex: 5 })]);
    page.commit([island("i", { hidden: true })]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([{ ...ISLAND_DEFAULTS, hidden: true }]);
  });

  it("sends an island's content when it changed, without an animation unless one is given", () => {
    const page = connect();
    page.commit([island("i")]);
    page.commit([island("i", { content: ui.text("Bye", { foreground: "#fff" }) })]);
    const [id, content, animation] = page.native.calls.islandSetContent[0] ?? [];
    expect(id).toBe(page.native.lastId);
    expect(decode(content ?? "")).toStrictEqual({ type: "text", text: "Bye", foreground: "#FFFFFFFF" });
    expect(animation).toBeNull();
  });

  it("passes the page's animation along with changed content", () => {
    const page = connect();
    page.commit([island("i")]);
    page.commit([island("i", { content: ui.text("Bye"), animation: { type: "spring", bounce: 0.3 } })]);
    expect(decode(page.native.calls.islandSetContent[0]?.[2] ?? "")).toStrictEqual({ type: "spring", bounce: 0.3 });
  });

  it("does not resend content that is the same, even with an animation", () => {
    const page = connect();
    page.commit([island("i")]);
    page.commit([island("i", { animation: "bouncy" })]);
    expect(page.native.calls.islandSetContent).toHaveLength(0);
  });
});

describe("items that are replaced or dropped", () => {
  it("removes a region that is missing from the next commit", () => {
    const page = connect();
    page.commit([region("a"), region("b")]);
    const [a, b] = [page.native.lastId - 1, page.native.lastId];
    page.commit([region("b")]);
    expect(page.native.removed()).toStrictEqual([a]);
    expect(page.native.framesOf(b)).toHaveLength(1);
  });

  it("removes an island that is missing from the next commit", () => {
    const page = connect();
    page.commit([island("i")]);
    page.commit([]);
    expect(page.native.removed()).toStrictEqual([page.native.lastId]);
  });

  it("removes a group that is missing from the next commit", () => {
    const page = connect();
    page.commit([], { g: {} });
    page.commit([]);
    expect(page.native.removed()).toStrictEqual([page.native.lastId]);
  });

  it("creates a dropped key again when it comes back", () => {
    const page = connect();
    page.commit([region("a")]);
    page.commit([]);
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(2);
  });

  it("recreates a region that moves into another group", () => {
    const page = connect();
    page.commit([region("a", { group: "one" })], { one: {}, two: {} });
    const [two, old] = [page.native.lastId - 1, page.native.lastId];
    page.commit([region("a", { group: "two" })], { one: {}, two: {} });
    expect(page.native.removed()).toStrictEqual([old]);
    expect(createdRegion(page, 1).groupId).toBe(two);
  });

  it("recreates a region that leaves its group", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    const old = page.native.lastId;
    page.commit([region("a")], { g: {} });
    expect(page.native.removed()).toStrictEqual([old]);
    expect(createdRegion(page, 1).groupId).toBe(0);
  });

  it("recreates a region that joins a group", () => {
    const page = connect();
    page.commit([region("a")]);
    page.commit([region("a", { group: "g" })], { g: {} });
    expect(page.native.calls.regionCreate).toHaveLength(2);
    expect(createdRegion(page, 1).groupId).not.toBe(0);
  });

  it("replaces a region with an island when the kind of a key changes", () => {
    const page = connect();
    page.commit([region("k")]);
    const old = page.native.lastId;
    page.commit([island("k")]);
    expect(page.native.removed()).toStrictEqual([old]);
    expect(page.native.calls.islandCreate).toHaveLength(1);
  });

  it("replaces an island with a region when the kind of a key changes", () => {
    const page = connect();
    page.commit([island("k")]);
    const old = page.native.lastId;
    page.commit([region("k")]);
    expect(page.native.removed()).toStrictEqual([old]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it("creates a group's regions again when the group returns after leaving", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    page.commit([]);
    page.commit([region("a", { group: "g" })], { g: {} });
    expect(createdRegion(page, 1).groupId).toBe(page.native.lastId - 1);
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "treats a group named %s like any other",
    (name) => {
      const page = connect();
      const payload = JSON.parse(
        `{"items":[{"kind":"region","key":"a","rect":${JSON.stringify(RECT)},"group":"${name}"}],"groups":{"${name}":{"spacing":4}}}`,
      );
      ipcMain.deliver(Channel.commit, page.contents, payload);
      const [group, member] = [page.native.lastId - 1, page.native.lastId];
      expect(decode(page.native.calls.groupCreate[0]?.[1] ?? "")).toStrictEqual({ spacing: 4, zIndex: 0 });
      expect(createdRegion(page).groupId).toBe(group);
      page.commit([]);
      expect(page.native.removed().sort()).toStrictEqual([group, member]);
      expect(page.errors).toStrictEqual([]);
    },
  );

  it("removes the regions of a group that is dropped together with them", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    const [group, member] = [page.native.lastId - 1, page.native.lastId];
    page.commit([]);
    expect(page.native.removed().sort()).toStrictEqual([group, member]);
  });

  it("removes a group named like an Object.prototype member when it leaves the commit", () => {
    const page = connect();
    page.commit([], { constructor: {} });
    page.commit([]);
    expect(page.native.removed()).toStrictEqual([page.native.lastId]);
  });

  it("brings a region back after its group left the commit for a while", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    page.commit([region("a", { group: "g" })]);
    page.commit([region("a", { group: "g" })], { g: {} });
    expect(page.native.calls.regionCreate).toHaveLength(2);
  });
});

describe("undocumented options", () => {
  const unstable = { unstable_variant: 2, unstable_scrim: true, unstable_subdued: true } as const;

  it("are not sent for a region whose page never used them", () => {
    const page = connect();
    page.commit([region("a")]);
    page.commit([region("a", { options: { zIndex: 1 } })]);
    const sent = JSON.stringify([createdRegion(page).options, page.native.updatesOf(page.native.lastId)]);
    expect(sent).not.toContain("unstable_");
  });

  it("are all sent on creation once the page uses one, the others at their defaults", () => {
    const page = connect();
    page.commit([region("a", { options: { unstable_scrim: true } })]);
    expect(createdRegion(page).options).toStrictEqual({
      frame: RECT,
      ...REGION_DEFAULTS,
      unstable_variant: 0,
      unstable_scrim: true,
      unstable_subdued: false,
    });
  });

  it("are sent as given", () => {
    const page = connect();
    page.commit([region("a", { options: unstable })]);
    expect(createdRegion(page).options).toMatchObject(unstable);
  });

  it("are reset to their defaults when the page stops using them", () => {
    const page = connect();
    page.commit([region("a", { options: unstable })]);
    page.commit([region("a")]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([
      { ...REGION_DEFAULTS, unstable_variant: 0, unstable_scrim: false, unstable_subdued: false },
    ]);
  });

  it("start being sent for a region that begins to use them", () => {
    const page = connect();
    page.commit([region("a")]);
    page.commit([region("a", { options: { unstable_subdued: true } })]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([
      { ...REGION_DEFAULTS, unstable_variant: 0, unstable_scrim: false, unstable_subdued: true },
    ]);
  });

  it("are tracked per region, not per page", () => {
    const page = connect();
    page.commit([region("a", { options: unstable }), region("b")]);
    expect(JSON.stringify(createdRegion(page, 1).options)).not.toContain("unstable_");
  });
});

describe("a frames message", () => {
  it("moves the regions and islands it names", () => {
    const page = connect();
    page.commit([region("a"), island("i")]);
    const [a, i] = [page.native.lastId - 1, page.native.lastId];
    ipcMain.deliver(Channel.frames, page.contents, [
      ["a", 1, 2, 3, 4],
      ["i", 5, 6, 7, 8],
    ]);
    expect(page.native.framesOf(a)).toStrictEqual([[1, 2, 3, 4, 0]]);
    expect(page.native.framesOf(i)).toStrictEqual([[5, 6, 7, 8, 0]]);
  });

  it("ignores keys the page never committed", () => {
    const page = connect();
    page.commit([region("a")]);
    const calls = page.during(() =>
      ipcMain.deliver(Channel.frames, page.contents, [
        ["nope", 1, 2, 3, 4],
        ["a", 1, 2, 3, 4],
      ]),
    );
    expect(calls).toStrictEqual(["objectSetFrame"]);
    expect(page.errors).toStrictEqual([]);
  });

  it("ignores the keys of groups", () => {
    const page = connect();
    page.commit([], { g: {} });
    expect(page.during(() => ipcMain.deliver(Channel.frames, page.contents, [["g", 1, 2, 3, 4]]))).toStrictEqual([]);
  });

  it("changes nothing but the frame", () => {
    const page = connect();
    page.commit([region("a")]);
    expect(page.during(() => ipcMain.deliver(Channel.frames, page.contents, [["a", 1, 2, 3, 4]]))).toStrictEqual([
      "objectSetFrame",
    ]);
  });
});

describe("a command", () => {
  it("sets a control's value on the island it names", () => {
    const page = connect();
    page.commit([island("i")]);
    ipcMain.deliver(Channel.command, page.contents, { type: "setValue", key: "i", node: "volume", value: 0.5 });
    expect(page.native.calls.islandSetValue).toStrictEqual([[page.native.lastId, "volume", "0.5"]]);
  });

  it("focuses a field of the island it names", () => {
    const page = connect();
    page.commit([island("i")]);
    ipcMain.deliver(Channel.command, page.contents, { type: "focus", key: "i", node: "field" });
    expect(page.native.calls.islandFocus).toStrictEqual([[page.native.lastId, "field"]]);
  });

  it("is ignored when its key names a region", () => {
    const page = connect();
    page.commit([region("a")]);
    const calls = page.during(() => {
      ipcMain.deliver(Channel.command, page.contents, { type: "setValue", key: "a", node: "volume", value: 1 });
      ipcMain.deliver(Channel.command, page.contents, { type: "focus", key: "a", node: "field" });
    });
    expect(calls).toStrictEqual([]);
    expect(page.errors).toStrictEqual([]);
  });

  it("is ignored when its key names nothing", () => {
    const page = connect();
    expect(
      page.during(() => ipcMain.deliver(Channel.command, page.contents, { type: "focus", key: "nope", node: "field" })),
    ).toStrictEqual([]);
    expect(page.errors).toStrictEqual([]);
  });
});

describe("island events", () => {
  it.each<IslandEvent>([
    { type: "press", node: "go" },
    { type: "change", node: "volume", value: 0.5 },
    { type: "submit", node: "field", value: "hello" },
    { type: "focus", node: "field" },
    { type: "blur", node: "field" },
  ])("send %j back to the page under the key the page chose", (event) => {
    const page = connect();
    page.commit([island("mine")]);
    page.native.emit(page.native.lastId, event);
    expect(page.events()).toStrictEqual([{ key: "mine", event }]);
  });

  it("are sent on the event channel", () => {
    const page = connect();
    page.commit([island("mine")]);
    page.native.emit(page.native.lastId, { type: "press", node: "go" });
    expect(page.contents.sent.at(-1)?.channel).toBe(Channel.event);
  });

  it("include the wanted size, which the page applies itself", () => {
    const page = connect();
    page.commit([island("mine", { fit: "both" })]);
    const event = { type: "resize", size: { width: 120, height: 32 } } as const;
    page.native.emit(page.native.lastId, event);
    expect(page.events()).toStrictEqual([{ key: "mine", event }]);
  });

  it("give the wanted size in the page's CSS pixels, dividing by the zoom factor", () => {
    const page = connect();
    page.contents.zoom = 2;
    page.commit([island("mine", { fit: "both" })]);
    page.native.emit(page.native.lastId, { type: "resize", size: { width: 120, height: 32 } });
    expect(page.events()).toStrictEqual([{ key: "mine", event: { type: "resize", size: { width: 60, height: 16 } } }]);
  });

  it("leave everything but a size untouched by the zoom factor", () => {
    const page = connect();
    page.contents.zoom = 2;
    page.commit([island("mine")]);
    page.native.emit(page.native.lastId, { type: "change", node: "volume", value: 0.5 });
    expect(page.events()).toStrictEqual([{ key: "mine", event: { type: "change", node: "volume", value: 0.5 } }]);
  });

  it("go to the page that owns the island", () => {
    const first = connect();
    const second = connect();
    second.commit([island("i")]);
    second.native.emit(second.native.lastId, { type: "press", node: "go" });
    expect(first.events()).toHaveLength(0);
    expect(second.events()).toHaveLength(1);
  });

  it("stop once the island is dropped", () => {
    const page = connect();
    page.commit([island("i")]);
    page.commit([]);
    page.native.emit(page.native.lastId, { type: "press", node: "go" });
    expect(page.events()).toHaveLength(0);
  });
});

describe("an island placed without a size", () => {
  const WANTED = { width: 120, height: 32 };
  const resized = { key: "i", event: { type: "resize", size: WANTED } };

  /** A fitted island that has reported its wanted size once, with the page's inbox emptied afterwards. */
  function measured(fit: BoundIsland["fit"]): Page {
    const page = connect();
    page.commit([island("i", { fit })]);
    page.native.emit(page.native.lastId, { type: "resize", size: WANTED });
    page.contents.sent.length = 0;
    return page;
  }

  it.each<[BoundIsland["fit"], Rect]>([
    ["both", { ...RECT, width: 0, height: 0 }],
    ["both", { ...RECT, width: 0 }],
    ["both", { ...RECT, height: 0 }],
    ["width", { ...RECT, width: 0 }],
    ["height", { ...RECT, height: 0 }],
  ])("is told its wanted size again when a commit with fit %s places it at %j", (fit, rect) => {
    const page = measured(fit);
    page.commit([island("i", { fit, rect })]);
    expect(page.events()).toStrictEqual([resized]);
  });

  it.each<[BoundIsland["fit"], [string, number, number, number, number]]>([
    ["both", ["i", 10, 20, 0, 0]],
    ["width", ["i", 10, 20, 0, 40]],
    ["height", ["i", 10, 20, 30, 0]],
  ])("is told its wanted size again when a frames message with fit %s places it at %j", (fit, placed) => {
    const page = measured(fit);
    ipcMain.deliver(Channel.frames, page.contents, [placed]);
    expect(page.events()).toStrictEqual([resized]);
  });

  it.each<[BoundIsland["fit"], Rect]>([
    ["both", RECT],
    ["width", { ...RECT, height: 0 }],
    ["height", { ...RECT, width: 0 }],
    ["none", { ...RECT, width: 0, height: 0 }],
  ])("is not told again with fit %s when placed at %j", (fit, rect) => {
    const page = measured(fit);
    page.commit([island("i", { fit, rect })]);
    ipcMain.deliver(Channel.frames, page.contents, [["i", rect.x, rect.y, rect.width, rect.height]]);
    expect(page.events()).toStrictEqual([]);
  });

  it("is told nothing while the island has not reported a size", () => {
    const page = connect();
    page.commit([island("i", { fit: "both" })]);
    page.commit([island("i", { fit: "both", rect: { ...RECT, width: 0, height: 0 } })]);
    ipcMain.deliver(Channel.frames, page.contents, [["i", 10, 20, 0, 0]]);
    expect(page.events()).toStrictEqual([]);
  });

  it("is told the latest wanted size", () => {
    const page = measured("both");
    const latest = { width: 300, height: 48 };
    page.native.emit(page.native.lastId, { type: "resize", size: latest });
    page.contents.sent.length = 0;
    page.commit([island("i", { fit: "both", rect: { ...RECT, width: 0 } })]);
    expect(page.events()).toStrictEqual([{ key: "i", event: { type: "resize", size: latest } }]);
  });

  it("is told the wanted size in CSS pixels at the zoom factor of the moment", () => {
    const page = measured("both");
    page.contents.zoom = 2;
    page.commit([island("i", { fit: "both", rect: { ...RECT, width: 0 } })]);
    expect(page.events()).toStrictEqual([{ key: "i", event: { type: "resize", size: { width: 60, height: 16 } } }]);
  });

  it("is told nothing once the key was dropped and bound again, until the new island reports", () => {
    const page = measured("both");
    page.commit([]);
    page.commit([island("i", { fit: "both", rect: { ...RECT, width: 0 } })]);
    expect(page.events()).toStrictEqual([]);
  });

  // The island forgets its wanted size when fit changes (island.ts), but the connection keeps offering the old one.
  it("is not offered a size measured under a different fit", () => {
    const page = measured("width");
    page.commit([island("i", { fit: "height", rect: { ...RECT, height: 0 } })]);
    expect(page.events()).toStrictEqual([]);
  });
});

describe("a page behind a WebContentsView", () => {
  const VIEW = { x: 200, y: 100, width: 400, height: 300 };
  const MOVED = { x: 300, y: 150, width: 400, height: 300 };

  it("has every frame re-applied at the new offset when the view moves", () => {
    const page = connect(VIEW);
    page.commit([region("a"), island("i", { rect: { x: 1, y: 2, width: 3, height: 4 } })]);
    const [a, i] = [page.native.lastId - 1, page.native.lastId];
    page.view?.setBounds(MOVED);
    expect(page.native.framesOf(a)).toStrictEqual([[310, 170, 30, 40, 0]]);
    expect(page.native.framesOf(i)).toStrictEqual([[301, 152, 3, 4, 0]]);
  });

  it("re-applies the regions inside groups too", () => {
    const page = connect(VIEW);
    page.commit([region("a", { group: "g" })], { g: {} });
    page.view?.setBounds(MOVED);
    expect(page.native.framesOf(page.native.lastId)).toStrictEqual([[310, 170, 30, 40, 0]]);
  });

  it("changes nothing but frames when the view moves", () => {
    const page = connect(VIEW);
    page.commit([region("a"), island("i")]);
    expect(page.during(() => page.view?.setBounds(MOVED))).toStrictEqual(["objectSetFrame", "objectSetFrame"]);
    expect(page.events()).toStrictEqual([]);
  });

  it("uses the rectangle of the latest commit", () => {
    const page = connect(VIEW);
    page.commit([region("a")]);
    page.commit([region("a", { rect: { x: 1, y: 2, width: 3, height: 4 } })]);
    page.view?.setBounds(MOVED);
    expect(page.native.framesOf(page.native.lastId).at(-1)).toStrictEqual([301, 152, 3, 4, 0]);
  });

  it("uses the rectangle of a later frames message", () => {
    const page = connect(VIEW);
    page.commit([region("a")]);
    ipcMain.deliver(Channel.frames, page.contents, [["a", 5, 6, 7, 8]]);
    page.view?.setBounds(MOVED);
    expect(page.native.framesOf(page.native.lastId).at(-1)).toStrictEqual([305, 156, 7, 8, 0]);
  });

  it("applies the zoom factor of the moment", () => {
    const page = connect(VIEW);
    page.commit([region("a")]);
    page.contents.zoom = 2;
    page.view?.setBounds(MOVED);
    expect(page.native.framesOf(page.native.lastId)).toStrictEqual([[320, 190, 60, 80, 0]]);
  });

  it("leaves dropped items alone when the view moves", () => {
    const page = connect(VIEW);
    page.commit([region("a")]);
    page.commit([]);
    expect(page.during(() => page.view?.setBounds(MOVED))).toStrictEqual([]);
  });

  it("stops following the view once the page is disconnected", () => {
    const page = connect(VIEW);
    page.disconnect();
    expect(page.view?.listenerCount("bounds-changed")).toBe(0);
  });
});

describe("who may place glass", () => {
  it("accepts messages from the main frame of a connected page", () => {
    const page = connect();
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it("accepts messages from the page of a connected WebContentsView", () => {
    const page = connect({ x: 0, y: 0, width: 400, height: 300 });
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it.each([
    ["commit", Channel.commit, message([region("b")])],
    ["frames", Channel.frames, [["a", 1, 2, 3, 4]]],
    ["command", Channel.command, { type: "focus", key: "i", node: "field" }],
  ] as const)("ignores a %s message from a sub-frame", (_name, channel, payload) => {
    const page = connect();
    page.commit([region("a"), island("i")]);
    expect(page.during(() => ipcMain.deliver(channel, page.contents, payload, page.contents.subFrame))).toStrictEqual(
      [],
    );
    expect(page.errors).toStrictEqual([]);
  });

  it("ignores a message whose frame is already gone", () => {
    const page = connect();
    expect(
      page.during(() => ipcMain.deliver(Channel.commit, page.contents, message([region("a")]), null)),
    ).toStrictEqual([]);
  });

  it.each([
    ["commit", Channel.commit, message([region("a")])],
    ["frames", Channel.frames, [["a", 1, 2, 3, 4]]],
    ["command", Channel.command, { type: "focus", key: "i", node: "field" }],
    ["malformed", Channel.commit, "nonsense"],
  ] as const)("ignores a %s message from a page that is not connected", (_name, channel, payload) => {
    const page = connect();
    const stranger = new FakeWebContents();
    expect(page.during(() => ipcMain.deliver(channel, stranger, payload))).toStrictEqual([]);
    expect(page.errors).toStrictEqual([]);
  });

  it("keeps the glass of two connected pages apart", () => {
    const first = connect();
    const second = connect();
    first.commit([region("a")]);
    second.commit([]);
    expect(first.native.removed()).toStrictEqual([]);
  });

  it("answers capability requests", () => {
    connect();
    expect(ipcMain.invoke(Channel.capabilities)).toStrictEqual({ ...GLASS_CAPABILITIES, platform: process.platform });
  });
});

describe("bad messages", () => {
  it.each([
    ["commit", Channel.commit, { items: "all of them" }, "items"],
    ["frames", Channel.frames, [["a", 1, 2, 3]], "frame"],
    ["command", Channel.command, { type: "explode", key: "i", node: "n" }, "command type"],
  ] as const)("reports a malformed %s message to onError instead of throwing", (_name, channel, payload, what) => {
    const page = connect();
    expect(() => ipcMain.deliver(channel, page.contents, payload)).not.toThrow();
    expect(page.errors).toStrictEqual([new TypeError(`electron-glasskit: malformed message from the page (${what}).`)]);
  });

  it("changes nothing when a commit is malformed", () => {
    const page = connect();
    page.commit([region("a")]);
    const calls = page.during(() =>
      ipcMain.deliver(Channel.commit, page.contents, { items: [region("b"), { kind: "region", key: "c" }] }),
    );
    expect(calls).toStrictEqual([]);
  });

  it("warns on the console when no onError is given", () => {
    const { host } = stage();
    const contents = new FakeWebContents();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    host.connect(asContents(contents));
    ipcMain.deliver(Channel.commit, contents, null);
    expect(warn).toHaveBeenCalledExactlyOnceWith("electron-glasskit: malformed message from the page (items).");
  });

  it("reports an addon failure to onError instead of throwing", () => {
    const page = connect();
    page.native.failOn("groupCreate", new Error("out of glass"));
    expect(() => page.commit([], { g: {} })).not.toThrow();
    expect(page.errors).toStrictEqual([new Error("out of glass")]);
  });

  it("reports a region that names a group the commit does not have", () => {
    const page = connect();
    page.commit([region("a", { group: "nope" })]);
    expect(page.errors).toStrictEqual([new TypeError('electron-glasskit: unknown group "nope".')]);
    expect(page.native.calls.regionCreate).toHaveLength(0);
  });

  // The check looks at the groups kept from the previous commit, which are only pruned after the items.
  it("reports an existing region whose group is not in the same commit", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    page.commit([region("a", { group: "g" })]);
    expect(page.errors).toStrictEqual([new TypeError('electron-glasskit: unknown group "g".')]);
  });

  // Same cause: the new region is created inside the stale group, then removed with it, without an error.
  it("reports a new region that names a group only the previous commit had", () => {
    const page = connect();
    page.commit([], { g: {} });
    page.commit([region("a", { group: "g" })]);
    expect(page.errors).toStrictEqual([new TypeError('electron-glasskit: unknown group "g".')]);
  });

  it("leaves nothing behind when a region names a group that left the commit", () => {
    const page = connect();
    page.commit([region("a", { group: "g" })], { g: {} });
    const [group, member] = [page.native.lastId - 1, page.native.lastId];
    page.commit([region("a", { group: "g" })]);
    expect(page.native.removed().sort()).toStrictEqual([group, member]);
  });

  it("creates the other items when one region has an invalid tint", () => {
    const page = connect();
    page.commit([region("bad", { options: { tint: "red" } }), region("good"), island("also-good")]);
    expect(page.errors.map((error) => error.message)).toStrictEqual([
      'Invalid colour "red". Use #RGB, #RRGGBB or #RRGGBBAA.',
    ]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
    expect(page.native.calls.islandCreate).toHaveLength(1);
  });

  it("creates the other items when one island has invalid content", () => {
    const page = connect();
    const twins: GlassNode = ui.hstack({}, [ui.toggle({ id: "same" }), ui.toggle({ id: "same" })]);
    page.commit([island("bad", { content: twins }), island("good"), region("also-good")]);
    expect(page.errors).toHaveLength(1);
    expect(page.native.calls.islandCreate).toHaveLength(1);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it("reports content the page shaped wrongly instead of throwing", () => {
    const page = connect();
    const payload = { items: [{ kind: "island", key: "i", rect: RECT, content: { type: "hstack" } }], groups: {} };
    expect(() => ipcMain.deliver(Channel.commit, page.contents, payload)).not.toThrow();
    expect(page.errors).toHaveLength(1);
    expect(page.native.calls.islandCreate).toHaveLength(0);
  });

  it("keeps an existing region as it was when its new options are invalid", () => {
    const page = connect();
    page.commit([region("a", { options: { tint: "#f00" } })]);
    const calls = page.during(() => page.commit([region("a", { options: { tint: "red" } })]));
    expect(calls).toStrictEqual([]);
    expect(page.errors).toHaveLength(1);
  });

  it("applies the fix once the page sends valid options again", () => {
    const page = connect();
    page.commit([region("a", { options: { tint: "#f00" } })]);
    page.commit([region("a", { options: { tint: "red" } })]);
    page.commit([region("a", { options: { tint: "#00f" } })]);
    expect(page.native.updatesOf(page.native.lastId)).toStrictEqual([{ ...REGION_DEFAULTS, tint: "#0000FFFF" }]);
  });

  it("does not create a second object for a key that appears twice in one commit", () => {
    const page = connect();
    page.commit([region("a"), region("a", { options: { zIndex: 1 } })]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });
});

describe("page lifecycle", () => {
  function filled(): Page & { ids: number[] } {
    const page = connect();
    page.commit([region("a"), region("b", { group: "g" }), island("i")], { g: {} });
    return { ...page, ids: [1, 2, 3, 4].map((offset) => page.native.lastId - 4 + offset) };
  }

  it("removes everything when a main-frame navigation has committed", () => {
    const page = filled();
    page.contents.navigate();
    expect(page.native.removed().sort()).toStrictEqual(page.ids);
  });

  it("keeps everything while a navigation has only started, since it may never commit", () => {
    const page = filled();
    page.contents.startNavigation();
    expect(page.native.removed()).toStrictEqual([]);
  });

  it("starts from nothing after a navigation, so the new document's keys are created", () => {
    const page = filled();
    page.contents.navigate();
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(3);
  });

  it("removes everything when the render process is gone", () => {
    const page = filled();
    page.contents.crash();
    expect(page.native.removed().sort()).toStrictEqual(page.ids);
  });

  it("stays connected after the render process is gone, for the reloaded page", () => {
    const page = filled();
    page.contents.crash();
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(3);
  });

  it("removes everything when the page is destroyed", () => {
    const page = filled();
    page.contents.destroy();
    expect(page.native.removed().sort()).toStrictEqual(page.ids);
  });

  it("lets the host close its window after the page was destroyed", () => {
    const page = filled();
    page.contents.destroy();
    const calls = page.during(() => page.window.destroy());
    expect(calls).toStrictEqual([]);
  });

  it("removes everything when the window closes over a page that is already gone, without reading its id", () => {
    const page = filled();
    page.contents.destroySilently();
    expect(() => page.window.destroy()).not.toThrow();
    expect(page.native.removed().sort()).toStrictEqual(page.ids);
  });

  it("can be disconnected after the page is gone", () => {
    const page = filled();
    page.contents.destroySilently();
    expect(() => page.disconnect()).not.toThrow();
    expect(page.native.removed().sort()).toStrictEqual(page.ids);
  });

  it("sends no island event to a page that is gone", () => {
    const page = connect();
    page.commit([island("i")]);
    page.contents.destroySilently();
    expect(() => page.native.emit(page.native.lastId, { type: "press", node: "go" })).not.toThrow();
    expect(page.events()).toStrictEqual([]);
  });

  it("removes everything when the host's window closes", () => {
    const page = filled();
    page.window.destroy();
    expect(page.native.removed().sort()).toStrictEqual(page.ids);
  });

  it("ignores messages after the host's window closes", () => {
    const page = filled();
    page.window.destroy();
    expect(() => page.commit([region("z")])).not.toThrow();
    expect(page.errors).toStrictEqual([]);
    expect(page.native.calls.regionCreate).toHaveLength(2);
  });
});

describe("connecting and disconnecting", () => {
  it("asks the page to commit everything again as soon as it connects", () => {
    const page = connect();
    expect(page.contents.sent).toStrictEqual([{ channel: Channel.resync, message: undefined }]);
  });

  it("asks again each time the page is connected", () => {
    const page = connect();
    page.disconnect();
    page.host.connect(asContents(page.contents));
    expect(page.contents.sent.map((sent) => sent.channel)).toStrictEqual([Channel.resync, Channel.resync]);
  });

  it("does not ask a page whose second connection was rejected", () => {
    const page = connect();
    expect(() => page.host.connect(asContents(page.contents))).toThrow();
    expect(page.contents.sent).toHaveLength(1);
  });

  it("throws when the same page is connected twice to one host", () => {
    const page = connect();
    expect(() => page.host.connect(asContents(page.contents))).toThrow(
      "This page is already connected to a glass host.",
    );
  });

  it("throws when the same page is connected to a second host", () => {
    const page = connect();
    const other = attachGlass(asWindow(new FakeWindow()));
    expect(() => other.connect(asContents(page.contents))).toThrow("This page is already connected to a glass host.");
  });

  it("throws when a view's page is already connected directly", () => {
    const page = connect();
    const view = new FakeView({ x: 0, y: 0, width: 1, height: 1 });
    Object.defineProperty(view, "webContents", { value: page.contents });
    expect(() => page.host.connect(asView(view))).toThrow("This page is already connected to a glass host.");
  });

  it("leaves the first connection working after a rejected second one", () => {
    const page = connect();
    expect(() => page.host.connect(asContents(page.contents))).toThrow();
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it("removes everything the page placed when it is disconnected", () => {
    const page = connect();
    page.commit([region("a"), region("b", { group: "g" }), island("i")], { g: {} });
    const last = page.native.lastId;
    page.disconnect();
    expect(page.native.removed().sort()).toStrictEqual([last - 3, last - 2, last - 1, last]);
  });

  it("ignores the page's messages after it is disconnected", () => {
    const page = connect();
    page.disconnect();
    expect(page.during(() => page.commit([region("a")]))).toStrictEqual([]);
    expect(page.errors).toStrictEqual([]);
  });

  it("stops listening to the page after it is disconnected", () => {
    const page = connect();
    page.disconnect();
    const listening = ["did-navigate", "render-process-gone", "destroyed"].map((name) =>
      page.contents.listenerCount(name),
    );
    expect(listening).toStrictEqual([0, 0, 0]);
  });

  it("can be disconnected twice", () => {
    const page = connect();
    page.commit([region("a")]);
    page.disconnect();
    expect(page.during(() => page.disconnect())).toStrictEqual([]);
  });

  it("lets the page connect again after it is disconnected", () => {
    const page = connect();
    page.disconnect();
    page.host.connect(asContents(page.contents));
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it("does not let a stale disconnect take down the page's new connection", () => {
    const page = connect();
    page.disconnect();
    page.host.connect(asContents(page.contents));
    page.disconnect();
    page.commit([region("a")]);
    expect(page.native.calls.regionCreate).toHaveLength(1);
  });

  it("leaves glass the app added itself alone", () => {
    const page = connect();
    const own = page.host.addRegion({ frame: RECT });
    page.commit([region("a")]);
    page.disconnect();
    expect(own.isRemoved).toBe(false);
  });
});
