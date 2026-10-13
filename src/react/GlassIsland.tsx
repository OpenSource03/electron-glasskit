import {
  type ComponentPropsWithoutRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type RefAttributes,
  useImperativeHandle,
} from "react";
import { type GlassIslandHandle, type UseGlassIslandOptions, useGlassCapabilities, useGlassIsland } from "./hooks.js";

type IslandProps = Omit<UseGlassIslandOptions, "hidden">;

export interface GlassIslandProps extends IslandProps, Omit<ComponentPropsWithoutRef<"div">, keyof IslandProps> {}

/**
 * An element with a native SwiftUI island at its box. `children` are rendered only
 * where islands are unavailable, as the stand-in for the native content. The `hidden`
 * attribute hides the island along with the element.
 */
export const GlassIsland: ForwardRefExoticComponent<GlassIslandProps & RefAttributes<GlassIslandHandle>> =
  /* @__PURE__ */ forwardRef<GlassIslandHandle, GlassIslandProps>(function GlassIsland(props, forwarded) {
    const {
      content,
      animation,
      fit,
      passthrough,
      appearance,
      zIndex,
      applySize,
      tracking,
      fallback,
      onPress,
      onChange,
      onSubmit,
      onFocus,
      onBlur,
      onResize,
      children,
      ...rest
    } = props;
    const [ref, handle] = useGlassIsland<HTMLDivElement>({
      content,
      animation,
      fit,
      passthrough,
      appearance,
      zIndex,
      applySize,
      tracking,
      fallback,
      onPress,
      onChange,
      onSubmit,
      onFocus,
      onBlur,
      onResize,
    });
    useImperativeHandle(forwarded, () => handle, [handle]);
    const capabilities = useGlassCapabilities();
    return (
      <div {...rest} ref={ref}>
        {capabilities?.islands === false ? children : null}
      </div>
    );
  });
