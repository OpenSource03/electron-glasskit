import { type Context, createContext } from "react";
import type { GroupBinding } from "../renderer/index.js";

/** The group that `<Glass>` elements below a `<GlassGroup>` merge within. */
export const GroupContext: Context<GroupBinding | null> = /* @__PURE__ */ createContext<GroupBinding | null>(null);
