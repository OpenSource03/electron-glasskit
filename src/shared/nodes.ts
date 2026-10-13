import type { Color, GlassStyle } from "./types.js";

/**
 * The declarative tree an island renders natively with SwiftUI.
 * Every node is plain JSON, so a tree can cross IPC unchanged.
 */

export type Alignment =
  | "center"
  | "leading"
  | "trailing"
  | "top"
  | "bottom"
  | "topLeading"
  | "topTrailing"
  | "bottomLeading"
  | "bottomTrailing";

export type FontWeight =
  | "ultraLight"
  | "thin"
  | "light"
  | "regular"
  | "medium"
  | "semibold"
  | "bold"
  | "heavy"
  | "black";
export type FontDesign = "default" | "rounded" | "serif" | "monospaced";

export interface FontSpec {
  /** Point size. @default 13 */
  size?: number;
  /** @default "regular" */
  weight?: FontWeight;
  /** @default "default" */
  design?: FontDesign;
}

export interface EdgeInsets {
  top?: number;
  bottom?: number;
  leading?: number;
  trailing?: number;
  /** Shorthand for `leading` and `trailing`. */
  horizontal?: number;
  /** Shorthand for `top` and `bottom`. */
  vertical?: number;
}

export interface FrameSpec {
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number | "infinity";
  minHeight?: number;
  maxHeight?: number | "infinity";
  /** Where the content sits inside a frame larger than itself. @default "center" */
  alignment?: Alignment;
}

export type ShapeSpec =
  | "capsule"
  | "circle"
  | "rect"
  | { type: "rect"; cornerRadius: number }
  /** An SVG path (`d` attribute). It is scaled to fit unless `viewBox` pins its coordinate space. */
  | { type: "path"; d: string; viewBox?: [width: number, height: number] }
  /** The outline of a string, scaled to fit. */
  | { type: "text"; text: string; weight?: FontWeight; design?: FontDesign };

export interface GlassEffectSpec {
  /** @default "regular" */
  style?: GlassStyle;
  tint?: Color;
  /** System press feedback. @default false */
  interactive?: boolean;
  /** @default "capsule" */
  shape?: ShapeSpec;
  /**
   * Identity used to morph this glass between updates. Defaults to the node's `id`.
   * Glass with the same identity in two consecutive trees animates from one to the other.
   */
  morphId?: string;
  /** Glass with the same union name inside one container is drawn as a single piece. */
  union?: string;
}

interface NodeBase {
  /** Names the node in events and keeps its state across updates. Required on controls. */
  id?: string;
  padding?: number | EdgeInsets;
  frame?: FrameSpec;
  /** Put the node on Liquid Glass. `true` is regular glass in a capsule. */
  glass?: boolean | GlassEffectSpec;
  /** A plain fill behind the node. */
  background?: Color | { color: Color; shape?: ShapeSpec };
  /** Text and symbol colour for this node and its children. */
  foreground?: Color;
  /** Font for this node and its children. */
  font?: FontSpec;
  opacity?: number;
  hidden?: boolean;
  disabled?: boolean;
  /** Tooltip. */
  help?: string;
  accessibilityLabel?: string;
}

export interface StackNode extends NodeBase {
  type: "hstack" | "vstack" | "zstack";
  /** Gap between children, in points. Ignored by `zstack`. */
  spacing?: number;
  alignment?: Alignment;
  children: GlassNode[];
}

/** Draws its glass children in one pass so they can merge and morph into each other. */
export interface GlassContainerNode extends NodeBase {
  type: "glassContainer";
  /** Distance at which glass children start to flow together. @default 0 */
  spacing?: number;
  children: GlassNode[];
}

export interface SpacerNode extends NodeBase {
  type: "spacer";
  minLength?: number;
}

export interface TextNode extends NodeBase {
  type: "text";
  text: string;
  lineLimit?: number;
}

/** An SF Symbol. */
export interface SymbolNode extends NodeBase {
  type: "symbol";
  name: string;
  size?: number;
  weight?: FontWeight;
}

export interface ShapeNode extends NodeBase {
  type: "shape";
  shape: ShapeSpec;
  fill?: Color;
}

export interface DividerNode extends NodeBase {
  type: "divider";
}

export interface ProgressNode extends NodeBase {
  type: "progress";
  /** 0 to 1. Omit for an indeterminate spinner. */
  value?: number;
}

/** Emits `press`. */
export interface ButtonNode extends NodeBase {
  type: "button";
  id: string;
  /** The button's content. A string is a text label. */
  label: string | GlassNode;
  /**
   * `plain` draws only the label, so `glass` on the node decides the look.
   * @default "plain"
   */
  style?: "plain" | "glass" | "glassProminent";
}

/** Emits `change` with a boolean. */
export interface ToggleNode extends NodeBase {
  type: "toggle";
  id: string;
  isOn?: boolean;
  label?: string;
  /** @default "switch" */
  style?: "switch" | "checkbox" | "button";
}

/** Emits `change` with a number. */
export interface SliderNode extends NodeBase {
  type: "slider";
  id: string;
  value?: number;
  /** @default 0 */
  min?: number;
  /** @default 1 */
  max?: number;
  step?: number;
}

/** Emits `change` with the text, `submit` on Return, and `focus` / `blur`. */
export interface TextFieldNode extends NodeBase {
  type: "textField";
  id: string;
  text?: string;
  placeholder?: string;
  /**
   * Grow with the text. Shift-Return adds a line and Return still submits.
   * `true` allows up to 8 lines.
   * @default false
   */
  multiline?: boolean | { maxLines: number };
  /** Empty the field after it submits. @default false */
  clearOnSubmit?: boolean;
}

export interface PickerOption {
  value: string;
  label?: string;
  /** SF Symbol shown with or instead of the label. */
  symbol?: string;
}

/** Emits `change` with the selected option's value. */
export interface PickerNode extends NodeBase {
  type: "picker";
  id: string;
  selection?: string;
  options: PickerOption[];
  /** @default "segmented" */
  style?: "segmented" | "menu";
}

export interface MenuItem {
  id: string;
  title: string;
  symbol?: string;
  disabled?: boolean;
  /** Marks the item as destructive. */
  destructive?: boolean;
}

/** A pull-down menu. Emits `press` with the chosen item's id as the node. */
export interface MenuNode extends NodeBase {
  type: "menu";
  label: string | GlassNode;
  items: Array<MenuItem | "divider">;
}

export type GlassNode =
  | StackNode
  | GlassContainerNode
  | SpacerNode
  | TextNode
  | SymbolNode
  | ShapeNode
  | DividerNode
  | ProgressNode
  | ButtonNode
  | ToggleNode
  | SliderNode
  | TextFieldNode
  | PickerNode
  | MenuNode;

export type NodeType = GlassNode["type"];

/** The value a control holds, as reported by `change` and accepted by `setValue`. */
export type NodeValue = string | number | boolean;

export type IslandAnimation =
  | "none"
  | "default"
  | "smooth"
  | "snappy"
  | "bouncy"
  | { type: "spring"; duration?: number; bounce?: number }
  | { type: "easeInOut"; duration?: number };

export type IslandEvent =
  | { type: "press"; node: string }
  | { type: "change"; node: string; value: NodeValue }
  | { type: "submit"; node: string; value: string }
  | { type: "focus"; node: string }
  | { type: "blur"; node: string }
  /** The size the content wants, given the island's `fit`. */
  | { type: "resize"; size: { width: number; height: number } };

export type IslandEventType = IslandEvent["type"];

/** The event of one type, e.g. `IslandEventOf<"submit">` is `{ type: "submit"; node; value }`. */
export type IslandEventOf<Type extends IslandEventType> = Extract<IslandEvent, { type: Type }>;

type Props<T extends GlassNode> = Omit<T, "type">;
type Container<T extends StackNode | GlassContainerNode> = Omit<T, "type" | "children">;

/** Typed constructors for {@link GlassNode} trees. They only build plain objects. */
export const ui = {
  hstack: (props: Container<StackNode>, children: GlassNode[]): StackNode => ({ type: "hstack", ...props, children }),
  vstack: (props: Container<StackNode>, children: GlassNode[]): StackNode => ({ type: "vstack", ...props, children }),
  zstack: (props: Container<StackNode>, children: GlassNode[]): StackNode => ({ type: "zstack", ...props, children }),
  glassContainer: (props: Container<GlassContainerNode>, children: GlassNode[]): GlassContainerNode => ({
    type: "glassContainer",
    ...props,
    children,
  }),
  spacer: (props: Props<SpacerNode> = {}): SpacerNode => ({ type: "spacer", ...props }),
  text: (text: string, props: Omit<Props<TextNode>, "text"> = {}): TextNode => ({ type: "text", text, ...props }),
  symbol: (name: string, props: Omit<Props<SymbolNode>, "name"> = {}): SymbolNode => ({
    type: "symbol",
    name,
    ...props,
  }),
  shape: (shape: ShapeSpec, props: Omit<Props<ShapeNode>, "shape"> = {}): ShapeNode => ({
    type: "shape",
    shape,
    ...props,
  }),
  divider: (props: Props<DividerNode> = {}): DividerNode => ({ type: "divider", ...props }),
  progress: (props: Props<ProgressNode> = {}): ProgressNode => ({ type: "progress", ...props }),
  button: (props: Props<ButtonNode>): ButtonNode => ({ type: "button", ...props }),
  toggle: (props: Props<ToggleNode>): ToggleNode => ({ type: "toggle", ...props }),
  slider: (props: Props<SliderNode>): SliderNode => ({ type: "slider", ...props }),
  textField: (props: Props<TextFieldNode>): TextFieldNode => ({ type: "textField", ...props }),
  picker: (props: Props<PickerNode>): PickerNode => ({ type: "picker", ...props }),
  menu: (props: Props<MenuNode>): MenuNode => ({ type: "menu", ...props }),
} as const;
