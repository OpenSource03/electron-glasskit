import type { GlassNode } from "../shared/nodes.js";
import { normalizeColor } from "./color.js";

const CONTROLS: ReadonlySet<GlassNode["type"]> = new Set(["button", "toggle", "slider", "textField", "picker"]);

function withColors<Node extends GlassNode>(node: Node): Node {
  const next = { ...node };
  if (next.foreground !== undefined) next.foreground = normalizeColor(next.foreground);
  if (typeof next.background === "string") next.background = normalizeColor(next.background);
  else if (next.background) next.background = { ...next.background, color: normalizeColor(next.background.color) };
  if (typeof next.glass === "object" && next.glass.tint !== undefined) {
    next.glass = { ...next.glass, tint: normalizeColor(next.glass.tint) };
  }
  return next;
}

/** Deeper trees than any real layout needs; the native renderer recurses once per level. */
const MAX_DEPTH = 64;

function prepare(node: GlassNode, ids: Set<string>, depth = 1): GlassNode {
  if (depth > MAX_DEPTH) throw new TypeError(`Island content is nested more than ${MAX_DEPTH} levels deep.`);
  if (CONTROLS.has(node.type)) {
    if (!node.id) throw new TypeError(`A "${node.type}" node needs an id.`);
    if (ids.has(node.id))
      throw new TypeError(`Duplicate node id "${node.id}". Control ids must be unique in an island.`);
    ids.add(node.id);
  }
  const next = withColors(node);
  switch (next.type) {
    case "hstack":
    case "vstack":
    case "zstack":
    case "glassContainer":
      return { ...next, children: next.children.map((child) => prepare(child, ids, depth + 1)) };
    case "shape":
      return next.fill === undefined ? next : { ...next, fill: normalizeColor(next.fill) };
    case "button":
    case "menu":
      return typeof next.label === "string" ? next : { ...next, label: prepare(next.label, ids, depth + 1) };
    default:
      return next;
  }
}

/** Checks a tree and rewrites its colours into the form the native side reads. */
export function prepareContent(content: GlassNode): GlassNode {
  return prepare(content, new Set());
}
