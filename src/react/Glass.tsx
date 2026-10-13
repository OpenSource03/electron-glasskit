import { type ComponentPropsWithoutRef, forwardRef, type ReactElement, type Ref, useContext } from "react";
import type { GlassStyle, RegionBindingOptions } from "../renderer/index.js";
import { GroupContext } from "./context.js";
import { useGlassRegion } from "./hooks.js";
import { useMergedRef } from "./internal.js";

/** The HTML elements `<Glass>` can render as. */
export type GlassTag = keyof HTMLElementTagNameMap;

interface GlassOwnProps extends Omit<RegionBindingOptions, "style" | "hidden" | "group"> {
  /** The region's `style` option, renamed because `style` is the element's CSS. @default "regular" */
  glassStyle?: GlassStyle;
}

export type GlassProps<T extends GlassTag = "div"> = GlassOwnProps &
  Omit<ComponentPropsWithoutRef<T>, keyof GlassOwnProps | "as"> & {
    /** @default "div" */
    as?: T;
    ref?: Ref<HTMLElementTagNameMap[T]>;
  };

/**
 * An element with native glass at its box. Its children are drawn under the glass.
 * The `hidden` attribute hides the glass along with the element.
 */
export type GlassComponent = <T extends GlassTag = "div">(props: GlassProps<T>) => ReactElement | null;

const GlassImpl = /* @__PURE__ */ forwardRef<HTMLDivElement, GlassProps>(function Glass(props, forwarded) {
  const {
    as: Tag = "div",
    glassStyle,
    tint,
    appearance,
    unstable_variant,
    unstable_scrim,
    unstable_subdued,
    cornerRadius,
    interactive,
    passthrough,
    zIndex,
    tracking,
    fallback,
    ...rest
  } = props;
  const group = useContext(GroupContext);
  const options: RegionBindingOptions = {
    style: glassStyle,
    tint,
    appearance,
    unstable_variant,
    unstable_scrim,
    unstable_subdued,
    cornerRadius,
    interactive,
    passthrough,
    zIndex,
    tracking,
    fallback,
    group,
  };
  return <Tag {...rest} ref={useMergedRef(useGlassRegion(options), forwarded)} />;
});

// forwardRef cannot express a component that is generic over its `as` tag.
export const Glass: GlassComponent = GlassImpl as GlassComponent;
