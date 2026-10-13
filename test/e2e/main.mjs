// End-to-end checks against the real native addon. Windows stay hidden so nothing takes focus.
import assert from "node:assert/strict";
import path from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";
import { attachGlass, getCapabilities, glassWindowOptions, liquidGlass, preloadPath, ui } from "../../dist/index.js";
import { run, sleep, test, until } from "./harness.mjs";

app.dock?.hide();
// Every test closes its window; without a listener Electron would quit after the first one.
app.on("window-all-closed", () => {});

const capabilities = getCapabilities();
const REGION_CLASS = capabilities.glass ? "LiquidGlassView" : "BlurView";

function makeWindow(options = {}) {
  return new BrowserWindow({ width: 800, height: 600, show: false, ...options });
}

/** Runs `body` with a fresh hidden window and its glass host, then destroys the window. */
async function withWindow(body, options) {
  const window = makeWindow(options);
  try {
    await body(window, attachGlass(window));
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

const pagePath = path.join(import.meta.dirname, "page.html");
const evaluate = (window, code) => window.webContents.executeJavaScript(code);
const rectOf = (window, id) =>
  evaluate(
    window,
    `(({ x, y, width, height }) => ({ x, y, width, height }))(document.getElementById("${id}").getBoundingClientRect())`,
  );

const frameOf = (host, id) => host.inspect().objects.find((object) => object.id === id)?.frame;
const kinds = (host) => host.inspect().objects.map((object) => object.id);

test("capabilities describe this machine", () => {
  assert.equal(capabilities.platform, "darwin");
  assert.match(capabilities.osVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(capabilities.glass || capabilities.fallback, "neither glass nor its fallback is available");
  assert.equal(typeof capabilities.islands, "boolean");
});

test("a region lands above the page at its frame", () =>
  withWindow((_window, host) => {
    const frame = { x: 40, y: 50, width: 300, height: 80 };
    const region = host.addRegion({ frame, cornerRadius: 20, tint: "#f0f" });
    const state = host.inspect();
    assert.ok(state.overlay.attached);
    assert.ok(state.overlay.aboveContent);
    assert.deepEqual(state.overlay.frame, state.overlay.contentFrame);
    assert.equal(state.objects.length, 1);
    assert.deepEqual(state.objects[0], {
      id: region.id,
      kind: "region",
      viewClass: REGION_CLASS,
      frame,
      zIndex: 0,
      hidden: false,
    });
    assert.deepEqual(region.frame, frame);
  }));

test("glass stays above the page when Electron adds web views", () =>
  withWindow((window, host) => {
    host.addRegion({ frame: { x: 0, y: 0, width: 100, height: 100 } });
    const view = new WebContentsView();
    window.contentView.addChildView(view);
    view.setBounds({ x: 10, y: 10, width: 200, height: 200 });
    const { overlay } = host.inspect();
    assert.ok(overlay.attached && overlay.aboveContent);
  }));

test("zIndex orders regions and can change", () =>
  withWindow((_window, host) => {
    const frame = { x: 0, y: 0, width: 50, height: 50 };
    const a = host.addRegion({ frame });
    const b = host.addRegion({ frame, zIndex: 5 });
    const c = host.addRegion({ frame, zIndex: 1 });
    assert.deepEqual(kinds(host), [a.id, c.id, b.id]);
    a.update({ zIndex: 9 });
    assert.deepEqual(kinds(host), [c.id, b.id, a.id]);
  }));

test("update, hide, move and remove a region", () =>
  withWindow((_window, host) => {
    const region = host.addRegion({ frame: { x: 0, y: 0, width: 50, height: 50 } });
    region.update({ hidden: true, style: "clear", tint: null, cornerRadius: 12, unstable_variant: 2 });
    assert.equal(host.inspect().objects[0].hidden, true);
    region.setFrame({ x: 5, y: 6, width: 70, height: 80 });
    assert.deepEqual(frameOf(host, region.id), { x: 5, y: 6, width: 70, height: 80 });
    region.remove();
    assert.equal(host.inspect().objects.length, 0);
    assert.ok(region.isRemoved);
    region.update({ hidden: false }).setFrame({ x: 0, y: 0, width: 1, height: 1 });
  }));

test("a function frame follows the window size", () =>
  withWindow(async (window, host) => {
    const region = host.addRegion({
      frame: ({ width, height }) => ({ x: 20, y: height - 80, width: width - 40, height: 56 }),
    });
    const before = window.getContentBounds();
    assert.deepEqual(region.frame, { x: 20, y: before.height - 80, width: before.width - 40, height: 56 });
    window.setContentSize(640, 480);
    await until(() => region.frame.width === 600, { what: "the region to follow the resize" });
    assert.deepEqual(frameOf(host, region.id), { x: 20, y: 400, width: 600, height: 56 });
    assert.deepEqual(host.inspect().overlay.frame, host.inspect().overlay.contentFrame);
  }));

test("a group holds its regions and takes them with it", () =>
  withWindow((_window, host) => {
    const group = host.addGroup({ spacing: 40 });
    const a = group.addRegion({ frame: { x: 0, y: 0, width: 100, height: 60 }, cornerRadius: 30 });
    const b = group.addRegion({ frame: { x: 120, y: 0, width: 60, height: 60 }, cornerRadius: 30 });
    const [inspected] = host.inspect().objects;
    assert.equal(inspected.kind, "group");
    assert.deepEqual(
      inspected.members.map((member) => member.id),
      [a.id, b.id],
    );
    group.update({ spacing: 10 });

    // Stacking order applies inside a group too.
    a.update({ zIndex: 2 });
    assert.deepEqual(
      host.inspect().objects[0].members.map((member) => member.id),
      [b.id, a.id],
    );
    // A region removed on its own leaves the group without disturbing the rest.
    b.remove();
    assert.deepEqual(
      host.inspect().objects[0].members.map((member) => member.id),
      [a.id],
    );
    const c = group.addRegion({ frame: { x: 120, y: 0, width: 60, height: 60 } });

    group.remove();
    assert.equal(host.inspect().objects.length, 0);
    assert.ok(a.isRemoved && b.isRemoved && c.isRemoved);
    assert.throws(() => group.addRegion({ frame: { x: 0, y: 0, width: 1, height: 1 } }), /removed/);
  }));

test("the window background can be set, updated and cleared", () =>
  withWindow(
    (window, host) => {
      assert.equal(host.background, null);
      const background = host.setBackground({ tint: "#0a84ff33" });
      const { width, height } = window.getContentBounds();
      assert.deepEqual(host.inspect().background.frame, { x: 0, y: 0, width, height });
      assert.equal(host.setBackground({ style: "clear", opaque: true }), background);
      host.clearBackground();
      assert.equal(host.inspect().background, null);
      assert.equal(host.background, null);
    },
    { ...glassWindowOptions() },
  ));

test("window options for glass keep the traffic lights where they were put", () =>
  withWindow(
    (window, host) => {
      host.setBackground();
      assert.deepEqual(window.getWindowButtonPosition(), { x: 18, y: 20 });
    },
    { ...glassWindowOptions(), trafficLightPosition: { x: 18, y: 20 } },
  ));

test("the electron-liquid-glass API still works", () =>
  withWindow((window, host) => {
    assert.equal(liquidGlass.isGlassSupported(), capabilities.glass);
    const id = liquidGlass.addView(window.getNativeWindowHandle(), { cornerRadius: 12, tintColor: "#44000010" });
    assert.ok(id > 0);
    liquidGlass.unstable_setVariant(id, liquidGlass.GlassMaterialVariant.dock);
    liquidGlass.unstable_setScrim(id, 1);
    assert.ok(host.inspect().background);
  }));

if (capabilities.islands) {
  const composer = (text) =>
    ui.hstack(
      { spacing: 8, padding: { horizontal: 16, vertical: 8 }, glass: { shape: { type: "rect", cornerRadius: 24 } } },
      [
        ui.textField({ id: "message", text, placeholder: "Message", multiline: true }),
        ui.button({
          id: "send",
          label: ui.symbol("arrow.up"),
          glass: { interactive: true, shape: "circle", tint: "#0a84ff" },
        }),
      ],
    );

  test("an island renders, reports its size and resizes itself around its anchor", () =>
    withWindow(async (_window, host) => {
      const sizes = [];
      const island = host.addIsland({
        frame: { x: 100, y: 400, width: 400, height: 200 },
        content: composer(""),
        fit: "height",
        autoResize: { anchor: "bottom" },
      });
      island.on("resize", ({ size }) => sizes.push(size));
      await until(() => sizes.length > 0, { what: "the island's first size" });
      const { height } = sizes.at(-1);
      assert.ok(height > 20 && height < 200, `implausible height ${height}`);
      assert.deepEqual(island.frame, { x: 100, y: 600 - height, width: 400, height });
      assert.deepEqual(frameOf(host, island.id), island.frame);

      island.setValue("message", "one\ntwo\nthree\nfour");
      await until(() => sizes.at(-1).height > height, { what: "the island to grow with its text" });
      assert.equal(island.frame.y + island.frame.height, 600);
    }));

  test("island values, content updates and errors", () =>
    withWindow((_window, host) => {
      const island = host.addIsland({ frame: { x: 0, y: 0, width: 300, height: 60 }, content: composer("hello") });
      assert.equal(island.setValue("message", "changed"), true);
      assert.equal(island.setValue("nope", "x"), false);
      assert.equal(island.focus("nope"), false);
      island.setContent(ui.text("Replaced"), { animation: "bouncy" });
      island.update({ hidden: true, passthrough: true, appearance: "dark", zIndex: 3 });
      const [inspected] = host.inspect().objects;
      assert.equal(inspected.kind, "island");
      assert.equal(inspected.hidden, true);
      assert.equal(inspected.zIndex, 3);

      assert.throws(() => island.setContent({ type: "hologram" }), /hologram/);
      assert.throws(
        () => host.addIsland({ frame: { x: 0, y: 0, width: 1, height: 1 }, content: ui.button({ label: "No id" }) }),
        /needs an id/,
      );
      assert.throws(
        () => island.setContent(ui.hstack({}, [ui.toggle({ id: "same" }), ui.toggle({ id: "same" })])),
        /Duplicate node id/,
      );
      island.remove();
      assert.equal(host.inspect().objects.length, 0);
    }));
}

test("a page places glass from its DOM", () =>
  withWindow(
    async (window, host) => {
      const disconnect = host.connect(window.webContents);
      await window.loadFile(pagePath);
      // Electron remembers zoom per origin, so an interrupted earlier run could leave it changed.
      window.webContents.setZoomFactor(1);
      const expected = capabilities.islands ? 4 : 3;
      await until(() => host.inspect().objects.length === expected, { what: "the page's glass" });
      assert.equal((await evaluate(window, "window.state.capabilities")).glass, capabilities.glass);
      const barRect = await rectOf(window, "bar");
      await until(() => host.inspect().objects.some((object) => object.frame.width === barRect.width), {
        what: "the first layout",
      });

      const state = host.inspect();
      const region = (rect) =>
        state.objects.find(
          (object) => object.kind === "region" && object.frame.x === rect.x && object.frame.y === rect.y,
        );
      const bar = await rectOf(window, "bar");
      assert.deepEqual(region(bar)?.frame, bar);
      const group = state.objects.find((object) => object.kind === "group");
      assert.deepEqual(
        group.members.map((member) => member.frame),
        [await rectOf(window, "a"), await rectOf(window, "b")],
      );

      // A scrolling element takes its glass along; a fixed one stays put.
      const row = region(await rectOf(window, "row"));
      await evaluate(window, "window.scrollTo(0, 150)");
      await until(() => frameOf(host, row.id).y === row.frame.y - 150, { what: "the glass to follow the scroll" });
      assert.deepEqual(frameOf(host, region(bar).id), bar);

      // Page zoom scales CSS pixels; glass is placed in window points.
      window.webContents.setZoomFactor(2);
      await until(async () => frameOf(host, row.id).width === 600, { what: "the glass to follow the zoom" });
      window.webContents.setZoomFactor(1);

      await evaluate(window, `window.row.update({ hidden: true, cornerRadius: undefined })`);
      await until(() => host.inspect().objects.find((object) => object.id === row.id)?.hidden, {
        what: "the region to hide",
      });

      if (capabilities.islands) {
        const height = await until(() => evaluate(window, `window.state.events.at(-1)?.size.height`), {
          what: "the island's size to reach the page",
        });
        await until(async () => (await rectOf(window, "island")).height === height, {
          what: "the page to apply the island's size",
        });
        const island = host.inspect().objects.find((object) => object.kind === "island");
        assert.equal(island.frame.height, height);
      }

      // A reload starts over instead of stacking a second copy.
      await window.loadFile(pagePath);
      await until(() => host.inspect().objects.length === expected, { what: "the glass after a reload" });
      await sleep(100);
      assert.equal(host.inspect().objects.length, expected);

      disconnect();
      assert.equal(host.inspect().objects.length, 0);
    },
    { webPreferences: { preload: preloadPath } },
  ));

test("a page that loaded before it was connected is asked for its glass again", () =>
  withWindow(
    async (window, host) => {
      await window.loadFile(pagePath);
      await sleep(300);
      assert.equal(host.inspect().objects.length, 0);
      host.connect(window.webContents);
      await until(() => host.inspect().objects.length === (capabilities.islands ? 4 : 3), {
        what: "the glass after connecting late",
      });
    },
    { webPreferences: { preload: preloadPath } },
  ));

test("bad options are rejected with a clear message", () =>
  withWindow((_window, host) => {
    assert.throws(
      () => host.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 }, tint: "red" }),
      /Invalid colour/,
    );
    assert.throws(
      () => host.addRegion({ frame: { x: 0, y: Number.NaN, width: 10, height: 10 } }),
      /"y" must be a finite number/,
    );
    assert.throws(
      () => host.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 }, style: "frosted" }),
      /region options/,
    );
    assert.equal(host.inspect().objects.length, 0);
  }));

test("a panel is a child window positioned over the parent's content", () =>
  withWindow(async (window, host) => {
    const panel = host.createPanel({
      frame: ({ width, height }) => ({ x: 50, y: height - 100, width: width - 100, height: 56 }),
      cornerRadius: 28,
      show: false,
    });
    const content = window.getContentBounds();
    assert.equal(panel.window.getParentWindow(), window);
    assert.deepEqual(panel.window.getBounds(), {
      x: content.x + 50,
      y: content.y + content.height - 100,
      width: content.width - 100,
      height: 56,
    });
    assert.ok(attachGlass(panel.window).inspect().background);

    window.setContentSize(500, 400);
    await until(() => panel.window.getBounds().width === 400, { what: "the panel to follow the resize" });
    panel.update({ tint: "#ffffff22" }).setFrame({ x: 0, y: 0, width: 120, height: 40 });
    assert.equal(panel.window.getBounds().width, 120);
    panel.close();
    assert.ok(panel.window.isDestroyed());
  }));

test("dispose removes everything and the window can be attached again", () =>
  withWindow((window, host) => {
    const region = host.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 } });
    host.setBackground();
    host.dispose();
    assert.ok(host.isDisposed && region.isRemoved);
    assert.equal(host.inspect(), null);
    assert.throws(() => host.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 } }), /no longer usable/);

    const again = attachGlass(window);
    assert.notEqual(again, host);
    again.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 } });
    assert.equal(again.inspect().objects.length, 1);
    assert.equal(attachGlass(window), again);
  }));

test("closing the window cleans up without touching freed views", async () => {
  const window = makeWindow();
  const host = attachGlass(window);
  const region = host.addRegion({ frame: { x: 0, y: 0, width: 10, height: 10 } });
  const group = host.addGroup();
  window.destroy();
  await sleep(50);
  assert.ok(host.isDisposed && region.isRemoved && group.isRemoved);
  region.update({ hidden: true }).setFrame({ x: 1, y: 1, width: 1, height: 1 });
  region.remove();
  assert.equal(host.inspect(), null);
});

app.whenReady().then(async () => {
  const failed = await run(process.argv.find((argument) => argument.startsWith("--only="))?.slice(7));
  app.exit(failed ? 1 : 0);
});
