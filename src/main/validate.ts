import type { GlassNode, IslandAnimation, NodeValue } from "../shared/nodes.js";
import type { BoundItem, CommitMessage, FramesMessage, IslandCommand, IslandFit } from "../shared/protocol.js";
import {
  type GlassAppearance,
  type GlassStyle,
  GlassVariant,
  type GroupOptions,
  type Rect,
  type RegionOptions,
} from "../shared/types.js";

// Everything here guards messages from a page, which is less trusted than the main process.

const MAX_ITEMS = 256;
const MAX_KEY_LENGTH = 128;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_COMMIT_CONTENT_LENGTH = 1_000_000;

const STYLES: readonly GlassStyle[] = ["regular", "clear"];
const APPEARANCES: readonly GlassAppearance[] = ["auto", "light", "dark"];
const FITS: readonly IslandFit[] = ["none", "width", "height", "both"];
const ANIMATIONS = ["none", "default", "smooth", "snappy", "bouncy"] as const;
const VARIANTS: readonly GlassVariant[] = Object.values(GlassVariant);

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(what: string): never {
  throw new TypeError(`electron-glasskit: malformed message from the page (${what}).`);
}

function optional<Value>(fields: Fields, key: string, parse: (value: unknown) => Value | undefined): Value | undefined {
  const value = fields[key];
  if (value === undefined) return undefined;
  return parse(value) ?? fail(key);
}

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const boolean = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
const string = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const variant = (value: unknown): GlassVariant | undefined => VARIANTS.find((known) => known === value);
const oneOf =
  <Option extends string>(options: readonly Option[]) =>
  (value: unknown): Option | undefined =>
    options.find((option) => option === value);

function key(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_KEY_LENGTH) fail("key");
  return value;
}

function rect(value: unknown): Rect {
  if (!isFields(value)) fail("rect");
  const [x, y, width, height] = [number(value.x), number(value.y), number(value.width), number(value.height)];
  if (x === undefined || y === undefined || width === undefined || height === undefined) fail("rect");
  return { x, y, width, height };
}

function regionOptions(value: unknown): Omit<RegionOptions, "frame"> {
  if (!isFields(value)) fail("options");
  return {
    cornerRadius: optional(value, "cornerRadius", number),
    style: optional(value, "style", oneOf(STYLES)),
    tint: value.tint === null ? null : optional(value, "tint", string),
    appearance: optional(value, "appearance", oneOf(APPEARANCES)),
    interactive: optional(value, "interactive", boolean),
    passthrough: optional(value, "passthrough", boolean),
    zIndex: optional(value, "zIndex", number),
    hidden: optional(value, "hidden", boolean),
    unstable_variant: optional(value, "unstable_variant", variant),
    unstable_scrim: optional(value, "unstable_scrim", boolean),
    unstable_subdued: optional(value, "unstable_subdued", boolean),
  };
}

/**
 * Bounds the size of a tree and charges it to the commit's `budget`. Its structure is checked
 * later: depth and ids when it is prepared, everything else by the native decoder.
 */
function content(value: unknown, budget: { remaining: number }): GlassNode {
  if (!isFields(value) || typeof value.type !== "string") fail("content");
  const { length } = JSON.stringify(value);
  budget.remaining -= length;
  if (length > MAX_CONTENT_LENGTH || budget.remaining < 0) fail("content is too large");
  return value as unknown as GlassNode;
}

function animation(value: unknown): IslandAnimation | undefined {
  const named = oneOf(ANIMATIONS)(value);
  if (named || !isFields(value)) return named;
  const duration = optional(value, "duration", number);
  if (value.type === "spring") return { type: "spring", duration, bounce: optional(value, "bounce", number) };
  if (value.type === "easeInOut") return { type: "easeInOut", duration };
  return undefined;
}

function item(value: unknown, budget: { remaining: number }): BoundItem {
  if (!isFields(value)) fail("item");
  if (value.kind === "region") {
    return {
      kind: "region",
      key: key(value.key),
      rect: rect(value.rect),
      options: regionOptions(value.options ?? {}),
      group: optional(value, "group", string),
    };
  }
  if (value.kind === "island") {
    return {
      kind: "island",
      key: key(value.key),
      rect: rect(value.rect),
      content: content(value.content, budget),
      animation: optional(value, "animation", animation),
      fit: optional(value, "fit", oneOf(FITS)),
      passthrough: optional(value, "passthrough", boolean),
      appearance: optional(value, "appearance", oneOf(APPEARANCES)),
      zIndex: optional(value, "zIndex", number),
      hidden: optional(value, "hidden", boolean),
    };
  }
  return fail("kind");
}

export function parseCommit(value: unknown): CommitMessage {
  if (!isFields(value) || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) fail("items");
  let groups: Record<string, GroupOptions> = {};
  if (value.groups !== undefined) {
    if (!isFields(value.groups)) fail("groups");
    const entries = Object.entries(value.groups);
    if (entries.length > MAX_ITEMS) fail("groups");
    // fromEntries defines own properties, so a key such as "__proto__" cannot reach the prototype.
    groups = Object.fromEntries(
      entries.map(([name, options]): [string, GroupOptions] => {
        if (!isFields(options)) fail("group");
        return [
          key(name),
          { spacing: optional(options, "spacing", number), zIndex: optional(options, "zIndex", number) },
        ];
      }),
    );
  }
  const budget = { remaining: MAX_COMMIT_CONTENT_LENGTH };
  return { items: value.items.map((entry: unknown) => item(entry, budget)), groups };
}

export function parseFrames(value: unknown): FramesMessage {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) fail("frames");
  return value.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 5) fail("frame");
    const [name, x, y, width, height] = entry;
    const frame = rect({ x, y, width, height });
    return [key(name), frame.x, frame.y, frame.width, frame.height];
  });
}

function nodeValue(value: unknown): NodeValue | undefined {
  return string(value) ?? number(value) ?? boolean(value);
}

export function parseCommand(value: unknown): IslandCommand {
  if (!isFields(value)) fail("command");
  const node = string(value.node) ?? fail("node");
  if (value.type === "focus") return { type: "focus", key: key(value.key), node };
  if (value.type === "setValue") {
    return { type: "setValue", key: key(value.key), node, value: nodeValue(value.value) ?? fail("value") };
  }
  return fail("command type");
}
