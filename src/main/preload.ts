import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "electron";
import { route } from "./connect.js";

/** Absolute path of the preload script that exposes the bridge the renderer entry points use. */
export const preloadPath: string = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cjs");

/**
 * Registers the preload script for every page in `session`, alongside any preload of your own.
 * Call it before creating windows. Returns the registration id.
 */
export function installPreload(session: Session): string {
  route();
  return session.registerPreloadScript({ type: "frame", filePath: preloadPath });
}
