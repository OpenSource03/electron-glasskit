import { describe, expect, it } from "vitest";
import { parseCommand, parseCommit, parseFrames } from "../../../src/main/validate.js";

const RECT = { x: 1, y: 2, width: 3, height: 4 };

function region(overrides: object = {}): object {
  return { kind: "region", key: "region:1", rect: RECT, options: {}, ...overrides };
}

function island(overrides: object = {}): object {
  return { kind: "island", key: "island:1", rect: RECT, content: { type: "text", text: "Hi" }, ...overrides };
}

function commit(...items: object[]): object {
  return { items, groups: {} };
}

/** Island content whose JSON is a little over `characters` long. */
function bulky(characters: number): object {
  return { type: "text", text: "x".repeat(characters) };
}

/** Every rejection is a TypeError that says the message came from the page. */
function rejects(parse: () => void, what: string): void {
  expect(parse).toThrow(new TypeError(`electron-glasskit: malformed message from the page (${what}).`));
}

describe("parseCommit", () => {
  it("accepts an empty commit", () => {
    expect(parseCommit({ items: [], groups: {} })).toStrictEqual({ items: [], groups: {} });
  });

  it("treats missing groups as none", () => {
    expect(parseCommit({ items: [] })).toStrictEqual({ items: [], groups: {} });
  });

  it("accepts a region with every option", () => {
    const options = {
      cornerRadius: 12,
      style: "clear",
      tint: "#ff0000",
      appearance: "dark",
      interactive: true,
      passthrough: false,
      zIndex: 3,
      hidden: true,
      unstable_variant: 2,
      unstable_scrim: true,
      unstable_subdued: false,
    };
    const parsed = parseCommit(commit(region({ options, group: "g" })));
    expect(parsed.items).toEqual([{ kind: "region", key: "region:1", rect: RECT, options, group: "g" }]);
  });

  it("accepts a region without options", () => {
    const parsed = parseCommit(commit({ kind: "region", key: "a", rect: RECT }));
    expect(parsed.items).toEqual([{ kind: "region", key: "a", rect: RECT, options: {} }]);
  });

  it("keeps `tint: null`, which removes a tint", () => {
    const [item] = parseCommit(commit(region({ options: { tint: null } }))).items;
    expect(item).toMatchObject({ options: { tint: null } });
  });

  it("keeps false, zero and the empty string, which are valid values", () => {
    const [item] = parseCommit(
      commit(region({ options: { interactive: false, zIndex: 0, cornerRadius: 0 }, group: "" })),
    ).items;
    expect(item).toMatchObject({ options: { interactive: false, zIndex: 0, cornerRadius: 0 }, group: "" });
  });

  it("accepts an island with every option", () => {
    const options = {
      animation: "bouncy",
      fit: "both",
      passthrough: true,
      appearance: "light",
      zIndex: 2,
      hidden: false,
    };
    const parsed = parseCommit(commit(island(options)));
    expect(parsed.items).toEqual([
      { kind: "island", key: "island:1", rect: RECT, content: { type: "text", text: "Hi" }, ...options },
    ]);
  });

  it.each(["none", "default", "smooth", "snappy", "bouncy"])("accepts the named animation %s", (animation) => {
    const [item] = parseCommit(commit(island({ animation }))).items;
    expect(item).toMatchObject({ animation });
  });

  it("accepts a spring animation with and without its numbers", () => {
    const full = { type: "spring", duration: 0.4, bounce: 0.2 };
    const [first, second] = parseCommit(
      commit(island({ animation: full }), island({ key: "b", animation: { type: "spring" } })),
    ).items;
    expect(first).toMatchObject({ animation: full });
    expect(second).toMatchObject({ animation: { type: "spring" } });
  });

  it("accepts an easeInOut animation, which has no bounce", () => {
    const [item] = parseCommit(commit(island({ animation: { type: "easeInOut", duration: 0.3, bounce: 0.9 } }))).items;
    expect(JSON.stringify(item)).toContain('"animation":{"type":"easeInOut","duration":0.3}');
  });

  it("drops unknown keys on an animation", () => {
    const [item] = parseCommit(commit(island({ animation: { type: "spring", bounce: 0.1, extra: 1 } }))).items;
    expect(JSON.stringify(item)).not.toContain("extra");
  });

  it("accepts every known material preset, including 0", () => {
    const [first, second] = parseCommit(
      commit(region({ options: { unstable_variant: 0 } }), region({ key: "b", options: { unstable_variant: 23 } })),
    ).items;
    expect(first).toMatchObject({ options: { unstable_variant: 0 } });
    expect(second).toMatchObject({ options: { unstable_variant: 23 } });
  });

  it("accepts groups with and without options", () => {
    const parsed = parseCommit({ items: [], groups: { a: { spacing: 8, zIndex: 1 }, b: {} } });
    expect(parsed.groups).toEqual({ a: { spacing: 8, zIndex: 1 }, b: {} });
    expect(Object.keys(parsed.groups)).toStrictEqual(["a", "b"]);
  });

  it("accepts the largest allowed number of items", () => {
    const items = Array.from({ length: 256 }, (_, index) => region({ key: `region:${index}` }));
    expect(parseCommit({ items }).items).toHaveLength(256);
  });

  it("accepts the longest allowed key", () => {
    const key = "k".repeat(128);
    expect(parseCommit(commit(region({ key }))).items[0]?.key).toBe(key);
  });

  it("drops unknown keys on the message, an item, its rectangle, its options and a group", () => {
    const parsed = parseCommit({
      items: [
        region({ extra: 1, rect: { ...RECT, extra: 1 }, options: { zIndex: 1, extra: 1 } }),
        island({ extra: 1 }),
      ],
      groups: { g: { spacing: 2, extra: 1 } },
      extra: 1,
    });
    expect(JSON.stringify(parsed)).not.toContain("extra");
  });

  it("returns items in the order the page sent them", () => {
    const parsed = parseCommit(commit(region({ key: "b" }), island({ key: "a" }), region({ key: "c" })));
    expect(parsed.items.map((item) => item.key)).toStrictEqual(["b", "a", "c"]);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "commit"],
    ["an array", []],
    ["a message without items", { groups: {} }],
    ["items that are not an array", { items: { length: 0 } }],
    ["more than 256 items", { items: Array.from({ length: 257 }, () => region()) }],
  ])("rejects %s", (_name, message) => {
    rejects(() => parseCommit(message), "items");
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["an array", []],
    ["a string", "g"],
  ])("rejects groups given as %s", (_name, groups) => {
    rejects(() => parseCommit({ items: [], groups }), "groups");
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a number", 4],
    ["an array", []],
  ])("rejects a group given as %s", (_name, group) => {
    rejects(() => parseCommit({ items: [], groups: { g: group } }), "group");
  });

  it.each<[string, unknown]>([
    ["a string", "8"],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
  ])("rejects a group spacing given as %s", (_name, spacing) => {
    rejects(() => parseCommit({ items: [], groups: { g: { spacing } } }), "spacing");
  });

  it("rejects a group zIndex that is not a number", () => {
    rejects(() => parseCommit({ items: [], groups: { g: { zIndex: "1" } } }), "zIndex");
  });

  it("rejects a group whose key is too long", () => {
    rejects(() => parseCommit({ items: [], groups: { ["g".repeat(129)]: {} } }), "key");
  });

  it("rejects a group whose key is empty", () => {
    rejects(() => parseCommit({ items: [], groups: { "": {} } }), "key");
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "region"],
    ["an array", [region()]],
  ])("rejects an item given as %s", (_name, item) => {
    rejects(() => parseCommit({ items: [item] }), "item");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["unknown", "panel"],
    ["a number", 1],
  ])("rejects an item whose kind is %s", (_name, kind) => {
    rejects(() => parseCommit(commit({ ...region(), kind })), "kind");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["empty", ""],
    ["a number", 7],
    ["longer than 128 characters", "k".repeat(129)],
  ])("rejects a region whose key is %s", (_name, key) => {
    rejects(() => parseCommit(commit(region({ key }))), "key");
  });

  it("rejects an island whose key is too long", () => {
    rejects(() => parseCommit(commit(island({ key: "k".repeat(129) }))), "key");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["an array", [1, 2, 3, 4]],
    ["missing a side", { x: 1, y: 2, width: 3 }],
    ["holding a string", { ...RECT, width: "3" }],
    ["holding NaN", { ...RECT, x: Number.NaN }],
    ["holding Infinity", { ...RECT, height: Number.POSITIVE_INFINITY }],
  ])("rejects a rectangle that is %s", (_name, rect) => {
    rejects(() => parseCommit(commit(region({ rect }))), "rect");
    rejects(() => parseCommit(commit(island({ rect }))), "rect");
  });

  it.each<[string, unknown]>([
    ["a string", "clear"],
    ["an array", []],
    ["a number", 1],
  ])("rejects region options given as %s", (_name, options) => {
    rejects(() => parseCommit(commit(region({ options }))), "options");
  });

  it.each<[string, unknown]>([
    ["cornerRadius", "12"],
    ["cornerRadius", Number.NaN],
    ["style", "frosted"],
    ["style", 1],
    ["tint", 255],
    ["tint", false],
    ["appearance", "sepia"],
    ["interactive", "yes"],
    ["passthrough", 1],
    ["zIndex", "1"],
    ["zIndex", Number.POSITIVE_INFINITY],
    ["hidden", 0],
    ["unstable_variant", "dock"],
    ["unstable_variant", 24],
    ["unstable_variant", -1],
    ["unstable_variant", 1.5],
    ["unstable_scrim", 1],
    ["unstable_subdued", "true"],
  ])("rejects the region option %s given as %j", (name, value) => {
    rejects(() => parseCommit(commit(region({ options: { [name]: value } }))), name);
  });

  it("rejects a region whose group is not a string", () => {
    rejects(() => parseCommit(commit(region({ group: 3 }))), "group");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["a string", "text"],
    ["an array", [{ type: "text" }]],
    ["without a type", { text: "Hi" }],
    ["with a type that is not a string", { type: 1 }],
  ])("rejects island content that is %s", (_name, content) => {
    rejects(() => parseCommit(commit(island({ content }))), "content");
  });

  it("rejects island content larger than 200 000 characters of JSON", () => {
    const content = { type: "text", text: "x".repeat(200_000) };
    rejects(() => parseCommit(commit(island({ content }))), "content is too large");
  });

  it("accepts island content just under the size limit", () => {
    const content = { type: "text", text: "x".repeat(199_000) };
    expect(parseCommit(commit(island({ content }))).items).toHaveLength(1);
  });

  it.each<[string, unknown]>([
    ["animation", 1],
    ["animation", ["bouncy"]],
    ["animation", null],
    ["animation", "wobble"],
    ["animation", ""],
    ["animation", { type: "wobble" }],
    ["animation", { duration: 1 }],
    ["fit", "contain"],
    ["fit", true],
    ["passthrough", "no"],
    ["appearance", "sepia"],
    ["zIndex", Number.NaN],
    ["hidden", "false"],
  ])("rejects the island option %s given as %j", (name, value) => {
    rejects(() => parseCommit(commit(island({ [name]: value }))), name);
  });

  it.each<[string, object]>([
    ["duration", { type: "spring", duration: "fast" }],
    ["duration", { type: "easeInOut", duration: Number.NaN }],
    ["bounce", { type: "spring", bounce: true }],
  ])("rejects an animation whose %s is not a finite number", (name, animation) => {
    rejects(() => parseCommit(commit(island({ animation }))), name);
  });

  it("rejects the whole commit when one item is malformed", () => {
    rejects(() => parseCommit(commit(region({ key: "good" }), region({ rect: null }))), "rect");
  });

  it("keeps a group keyed __proto__ as an ordinary entry, leaving the prototype alone", () => {
    const parsed = parseCommit(JSON.parse('{"items":[],"groups":{"__proto__":{"spacing":4}}}'));
    expect(Object.getPrototypeOf(parsed.groups)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed.groups, "__proto__")).toBe(true);
    expect(Object.entries(parsed.groups)).toEqual([["__proto__", { spacing: 4 }]]);
  });

  it("accepts the largest allowed number of groups", () => {
    const groups = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`g${index}`, {}]));
    expect(Object.keys(parseCommit({ items: [], groups }).groups)).toHaveLength(256);
  });

  it("rejects more than 256 groups", () => {
    const groups = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`g${index}`, {}]));
    rejects(() => parseCommit({ items: [], groups }), "groups");
  });

  it("accepts islands whose contents together stay within 1 000 000 characters of JSON", () => {
    const islands = Array.from({ length: 5 }, (_, index) => island({ key: `i${index}`, content: bulky(190_000) }));
    expect(parseCommit(commit(...islands)).items).toHaveLength(5);
  });

  it("rejects a commit whose island contents together exceed 1 000 000 characters of JSON", () => {
    const islands = Array.from({ length: 6 }, (_, index) => island({ key: `i${index}`, content: bulky(190_000) }));
    rejects(() => parseCommit(commit(...islands)), "content is too large");
  });

  it("does not count regions against the content budget", () => {
    const islands = Array.from({ length: 5 }, (_, index) => island({ key: `i${index}`, content: bulky(190_000) }));
    const regions = Array.from({ length: 200 }, (_, index) => region({ key: `r${index}` }));
    expect(parseCommit(commit(...islands, ...regions)).items).toHaveLength(205);
  });

  it("gives every commit a fresh content budget", () => {
    const islands = Array.from({ length: 5 }, (_, index) => island({ key: `i${index}`, content: bulky(190_000) }));
    parseCommit(commit(...islands));
    expect(() => parseCommit(commit(...islands))).not.toThrow();
  });
});

describe("parseFrames", () => {
  it("accepts an empty list", () => {
    expect(parseFrames([])).toStrictEqual([]);
  });

  it("accepts `[key, x, y, width, height]` entries", () => {
    const frames = [
      ["a", 1, 2, 3, 4],
      ["b", -5.5, 0, 0, 10],
    ];
    expect(parseFrames(frames)).toStrictEqual(frames);
  });

  it("accepts the largest allowed number of entries", () => {
    expect(parseFrames(Array.from({ length: 256 }, (_, index) => [`k${index}`, 0, 0, 1, 1]))).toHaveLength(256);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["an object", { a: [0, 0, 1, 1] }],
    ["a string", "frames"],
    ["more than 256 entries", Array.from({ length: 257 }, () => ["a", 0, 0, 1, 1])],
  ])("rejects %s", (_name, message) => {
    rejects(() => parseFrames(message), "frames");
  });

  it.each<[string, unknown]>([
    ["not an array", { key: "a", ...RECT }],
    ["too short", ["a", 1, 2, 3]],
    ["too long", ["a", 1, 2, 3, 4, 5]],
    ["null", null],
  ])("rejects an entry that is %s", (_name, entry) => {
    rejects(() => parseFrames([entry]), "frame");
  });

  it.each<[string, unknown[]]>([
    ["a string coordinate", ["a", "1", 2, 3, 4]],
    ["NaN", ["a", 1, Number.NaN, 3, 4]],
    ["Infinity", ["a", 1, 2, Number.POSITIVE_INFINITY, 4]],
    ["a missing value", ["a", 1, 2, 3, undefined]],
  ])("rejects an entry with %s", (_name, entry) => {
    rejects(() => parseFrames([entry]), "rect");
  });

  it.each<[string, unknown]>([
    ["a number", 1],
    ["empty", ""],
    ["longer than 128 characters", "k".repeat(129)],
  ])("rejects an entry whose key is %s", (_name, key) => {
    rejects(() => parseFrames([[key, 1, 2, 3, 4]]), "key");
  });
});

describe("parseCommand", () => {
  it("accepts a focus command", () => {
    expect(parseCommand({ type: "focus", key: "island:1", node: "field" })).toStrictEqual({
      type: "focus",
      key: "island:1",
      node: "field",
    });
  });

  it.each<[string, string | number | boolean]>([
    ["a string", "hello"],
    ["an empty string", ""],
    ["a number", 0.5],
    ["zero", 0],
    ["true", true],
    ["false", false],
  ])("accepts a setValue command carrying %s", (_name, value) => {
    expect(parseCommand({ type: "setValue", key: "island:1", node: "field", value })).toStrictEqual({
      type: "setValue",
      key: "island:1",
      node: "field",
      value,
    });
  });

  it("drops unknown keys", () => {
    expect(parseCommand({ type: "focus", key: "k", node: "n", value: 1, extra: true })).toStrictEqual({
      type: "focus",
      key: "k",
      node: "n",
    });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "focus"],
    ["an array", ["focus", "k", "n"]],
  ])("rejects %s", (_name, command) => {
    rejects(() => parseCommand(command), "command");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["unknown", "blur"],
    ["a number", 1],
  ])("rejects a command whose type is %s", (_name, type) => {
    rejects(() => parseCommand({ type, key: "k", node: "n" }), "command type");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["a number", 3],
    ["null", null],
  ])("rejects a command whose node is %s", (_name, node) => {
    rejects(() => parseCommand({ type: "focus", key: "k", node }), "node");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["empty", ""],
    ["longer than 128 characters", "k".repeat(129)],
  ])("rejects a command whose key is %s", (_name, key) => {
    rejects(() => parseCommand({ type: "focus", key, node: "n" }), "key");
    rejects(() => parseCommand({ type: "setValue", key, node: "n", value: 1 }), "key");
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["an object", { value: 1 }],
    ["an array", [1]],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects a setValue command whose value is %s", (_name, value) => {
    rejects(() => parseCommand({ type: "setValue", key: "k", node: "n", value }), "value");
  });
});
