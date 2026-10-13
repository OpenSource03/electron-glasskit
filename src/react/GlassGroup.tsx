import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { createGroup, type GroupOptions } from "../renderer/index.js";
import { GroupContext } from "./context.js";

export interface GlassGroupProps extends GroupOptions {
  children?: ReactNode;
}

/** Makes the `<Glass>` elements below it merge into each other. Renders no element of its own. */
export function GlassGroup({ spacing, zIndex, children }: GlassGroupProps): ReactElement {
  // A group owns nothing until a region is bound with it, so creating it during render is safe.
  const [group] = useState(() => createGroup({ spacing, zIndex }));
  useEffect(() => {
    group.update({ spacing, zIndex });
  }, [group, spacing, zIndex]);
  return <GroupContext.Provider value={group}>{children}</GroupContext.Provider>;
}
