import { describe, expect, it } from "vitest";
import { prepareContent } from "../../../src/main/nodes.js";
import { type GlassNode, ui } from "../../../src/shared/nodes.js";

describe("prepareContent colours", () => {
  it("normalises a foreground colour", () => {
    expect(prepareContent(ui.text("Hi", { foreground: "#f00" }))).toStrictEqual(
      ui.text("Hi", { foreground: "#FF0000FF" }),
    );
  });

  it("normalises a background given as a colour", () => {
    expect(prepareContent(ui.text("Hi", { background: "#00ff00" }))).toStrictEqual(
      ui.text("Hi", { background: "#00FF00FF" }),
    );
  });

  it("normalises a background given as an object, keeping its shape", () => {
    const prepared = prepareContent(ui.text("Hi", { background: { color: "#0000ff88", shape: "circle" } }));
    expect(prepared).toStrictEqual(ui.text("Hi", { background: { color: "#0000FF88", shape: "circle" } }));
  });

  it("normalises a glass tint, keeping the other glass settings", () => {
    const prepared = prepareContent(ui.text("Hi", { glass: { tint: "#abc", style: "clear", interactive: true } }));
    expect(prepared).toStrictEqual(ui.text("Hi", { glass: { tint: "#AABBCCFF", style: "clear", interactive: true } }));
  });

  it("leaves glass without a tint alone", () => {
    const node = ui.text("Hi", { glass: { style: "clear" } });
    expect(prepareContent(node)).toStrictEqual(node);
  });

  it("leaves `glass: true` alone", () => {
    const node = ui.text("Hi", { glass: true });
    expect(prepareContent(node)).toStrictEqual(node);
  });

  it("normalises a shape's fill", () => {
    expect(prepareContent(ui.shape("circle", { fill: "#123" }))).toStrictEqual(
      ui.shape("circle", { fill: "#112233FF" }),
    );
  });

  it("leaves a shape without a fill alone", () => {
    expect(prepareContent(ui.shape("capsule"))).toStrictEqual(ui.shape("capsule"));
  });

  it.each(["hstack", "vstack", "zstack", "glassContainer"] as const)(
    "normalises colours in the children of a %s",
    (type) => {
      const prepared = prepareContent(
        ui[type]({}, [ui.text("A", { foreground: "#fff" }), ui.shape("rect", { fill: "#000" })]),
      );
      expect(prepared).toStrictEqual(
        ui[type]({}, [ui.text("A", { foreground: "#FFFFFFFF" }), ui.shape("rect", { fill: "#000000FF" })]),
      );
    },
  );

  it("normalises colours at any depth", () => {
    const prepared = prepareContent(
      ui.vstack({}, [ui.hstack({}, [ui.zstack({}, [ui.symbol("star", { foreground: "#f0f" })])])]),
    );
    expect(prepared).toStrictEqual(
      ui.vstack({}, [ui.hstack({}, [ui.zstack({}, [ui.symbol("star", { foreground: "#FF00FFFF" })])])]),
    );
  });

  it("normalises the colours of a container itself", () => {
    expect(prepareContent(ui.hstack({ background: "#111" }, []))).toStrictEqual(
      ui.hstack({ background: "#111111FF" }, []),
    );
  });

  it("normalises colours in a button's node label", () => {
    const prepared = prepareContent(ui.button({ id: "go", label: ui.symbol("play", { foreground: "#0f0" }) }));
    expect(prepared).toStrictEqual(ui.button({ id: "go", label: ui.symbol("play", { foreground: "#00FF00FF" }) }));
  });

  it("normalises colours in a menu's node label", () => {
    const prepared = prepareContent(ui.menu({ label: ui.text("More", { foreground: "#00f" }), items: [] }));
    expect(prepared).toStrictEqual(ui.menu({ label: ui.text("More", { foreground: "#0000FFFF" }), items: [] }));
  });

  it("leaves a string label alone", () => {
    const node = ui.button({ id: "go", label: "#f00" });
    expect(prepareContent(node)).toStrictEqual(node);
  });

  it("keeps everything that is not a colour", () => {
    const node = ui.slider({
      id: "volume",
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.1,
      padding: { horizontal: 4 },
      opacity: 0.8,
    });
    expect(prepareContent(node)).toStrictEqual(node);
  });

  it.each<[string, GlassNode]>([
    ["foreground", ui.text("Hi", { foreground: "red" })],
    ["background", ui.text("Hi", { background: "red" })],
    ["background colour", ui.text("Hi", { background: { color: "red" } })],
    ["glass tint", ui.text("Hi", { glass: { tint: "red" } })],
    ["shape fill", ui.shape("circle", { fill: "red" })],
    ["nested colour", ui.hstack({}, [ui.button({ id: "a", label: ui.text("Hi", { foreground: "red" }) })])],
  ])("rejects an invalid %s", (_place, node) => {
    expect(() => prepareContent(node)).toThrow('Invalid colour "red".');
  });
});

describe("prepareContent ids", () => {
  it.each<[string, GlassNode]>([
    ["button", ui.button({ id: "", label: "Go" })],
    ["toggle", ui.toggle({ id: "" })],
    ["slider", ui.slider({ id: "" })],
    ["textField", ui.textField({ id: "" })],
    ["picker", ui.picker({ id: "", options: [] })],
  ])("rejects a %s without an id", (type, node) => {
    expect(() => prepareContent(node)).toThrow(new TypeError(`A "${type}" node needs an id.`));
  });

  it("rejects two controls with the same id", () => {
    const tree = ui.hstack({}, [ui.toggle({ id: "same" }), ui.slider({ id: "same" })]);
    expect(() => prepareContent(tree)).toThrow(
      new TypeError('Duplicate node id "same". Control ids must be unique in an island.'),
    );
  });

  it("rejects a control inside a button's label that repeats an id used elsewhere", () => {
    const tree = ui.hstack({}, [
      ui.toggle({ id: "same" }),
      ui.button({ id: "outer", label: ui.toggle({ id: "same" }) }),
    ]);
    expect(() => prepareContent(tree)).toThrow('Duplicate node id "same".');
  });

  it("rejects a control inside a menu's label that repeats an id used elsewhere", () => {
    const tree = ui.hstack({}, [
      ui.toggle({ id: "same" }),
      ui.menu({ label: ui.button({ id: "same", label: "x" }), items: [] }),
    ]);
    expect(() => prepareContent(tree)).toThrow('Duplicate node id "same".');
  });

  it("accepts controls with different ids", () => {
    const tree = ui.hstack({}, [ui.toggle({ id: "a" }), ui.slider({ id: "b" }), ui.textField({ id: "c" })]);
    expect(prepareContent(tree)).toStrictEqual(tree);
  });

  it("lets nodes that are not controls omit their id", () => {
    const tree = ui.vstack({}, [
      ui.text("A"),
      ui.symbol("star"),
      ui.spacer(),
      ui.divider(),
      ui.progress(),
      ui.shape("rect"),
    ]);
    expect(prepareContent(tree)).toStrictEqual(tree);
  });

  it("lets nodes that are not controls share an id", () => {
    const tree = ui.vstack({ id: "same" }, [ui.text("A", { id: "same" }), ui.text("B", { id: "same" })]);
    expect(prepareContent(tree)).toStrictEqual(tree);
  });

  it("lets a node that is not a control share an id with a control", () => {
    const tree = ui.hstack({}, [ui.text("Volume", { id: "volume" }), ui.slider({ id: "volume" })]);
    expect(prepareContent(tree)).toStrictEqual(tree);
  });

  it("does not require an id on a menu", () => {
    const tree = ui.menu({ label: "More", items: [{ id: "copy", title: "Copy" }, "divider"] });
    expect(prepareContent(tree)).toStrictEqual(tree);
  });

  it("checks ids per call, so the same id may appear in two trees", () => {
    prepareContent(ui.toggle({ id: "same" }));
    expect(() => prepareContent(ui.toggle({ id: "same" }))).not.toThrow();
  });
});

describe("prepareContent input", () => {
  function deepFreeze<Value extends object>(value: Value): Value {
    for (const inner of Object.values(value)) {
      if (typeof inner === "object" && inner !== null) deepFreeze(inner);
    }
    return Object.freeze(value);
  }

  function tree(): GlassNode {
    return ui.vstack({ foreground: "#fff", background: { color: "#000" }, glass: { tint: "#abc" } }, [
      ui.shape("circle", { fill: "#123" }),
      ui.button({ id: "go", label: ui.text("Go", { foreground: "#0f0" }) }),
      ui.menu({ label: ui.text("More", { background: "#00f" }), items: [] }),
    ]);
  }

  it("does not mutate the tree it is given", () => {
    const input = deepFreeze(tree());
    prepareContent(input);
    expect(input).toStrictEqual(tree());
  });

  it("returns a new tree", () => {
    const input = tree();
    expect(prepareContent(input)).not.toBe(input);
  });
});

describe("prepareContent depth", () => {
  /** A text node wrapped in stacks until the tree is `levels` deep. */
  function nested(levels: number, leaf: GlassNode = ui.text("deep")): GlassNode {
    let node = leaf;
    for (let level = 1; level < levels; level++) node = ui.vstack({}, [node]);
    return node;
  }

  const TOO_DEEP = new TypeError("Island content is nested more than 64 levels deep.");

  it("accepts a tree 64 levels deep", () => {
    expect(() => prepareContent(nested(64))).not.toThrow();
  });

  it("rejects a tree 65 levels deep", () => {
    expect(() => prepareContent(nested(65))).toThrow(TOO_DEEP);
  });

  it("counts a button's label as a level", () => {
    const labelled = ui.button({ id: "go", label: ui.text("Go") });
    expect(() => prepareContent(nested(63, labelled))).not.toThrow();
    expect(() => prepareContent(nested(64, labelled))).toThrow(TOO_DEEP);
  });

  it("counts a menu's label as a level", () => {
    const labelled = ui.menu({ label: ui.text("More"), items: [] });
    expect(() => prepareContent(nested(63, labelled))).not.toThrow();
    expect(() => prepareContent(nested(64, labelled))).toThrow(TOO_DEEP);
  });

  it("does not count a string label as a level", () => {
    expect(() => prepareContent(nested(64, ui.button({ id: "go", label: "Go" })))).not.toThrow();
  });

  it("measures depth, not size, so a wide tree is fine", () => {
    const wide = ui.hstack(
      {},
      Array.from({ length: 500 }, (_, index) => ui.text(String(index))),
    );
    expect(() => prepareContent(wide)).not.toThrow();
  });

  it("rejects a too-deep branch anywhere in the tree", () => {
    expect(() => prepareContent(ui.hstack({}, [ui.text("shallow"), nested(64)]))).toThrow(TOO_DEEP);
  });
});
