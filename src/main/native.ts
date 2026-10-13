import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The compiled addon. Options cross as JSON strings; see native/include/glasskit.h. */
export interface NativeBinding {
  capabilities(): string;
  setEventCallback(listener: (id: number, json: string) => void): void;
  backgroundSet(handle: Buffer, options: string): number;
  groupCreate(handle: Buffer, options: string): number;
  regionCreate(handle: Buffer, groupId: number, options: string): number;
  islandCreate(handle: Buffer, options: string): number;
  objectUpdate(id: number, options: string): void;
  objectSetFrame(id: number, x: number, y: number, width: number, height: number, animateSeconds: number): void;
  objectRemove(id: number): void;
  islandSetContent(id: number, content: string, animation: string | null): void;
  islandSetValue(id: number, node: string, value: string): boolean;
  islandFocus(id: number, node: string): boolean;
  hostDetach(handle: Buffer): void;
  hostInspect(handle: Buffer): string | null;
}

/** Stands in for the addon off macOS, so calling code needs no platform checks. */
const inert: NativeBinding = {
  capabilities: () => "{}",
  setEventCallback: () => {},
  backgroundSet: () => 0,
  groupCreate: () => 0,
  regionCreate: () => 0,
  islandCreate: () => 0,
  objectUpdate: () => {},
  objectSetFrame: () => {},
  objectRemove: () => {},
  islandSetContent: () => {},
  islandSetValue: () => false,
  islandFocus: () => false,
  hostDetach: () => {},
  hostInspect: () => null,
};

function locate(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "prebuilds", `darwin-${process.arch}`, "glasskit.node"),
    path.join(here, "..", "native", "build", "Release", "glasskit.node"),
  ];
  // Inside an asar archive the binary is unpacked next to it.
  return (
    candidates.map((file) => file.replace("app.asar", "app.asar.unpacked")).find(existsSync) ??
    candidates.find(existsSync) ??
    null
  );
}

function load(): NativeBinding {
  if (process.platform !== "darwin") return inert;
  const file = locate();
  if (!file) {
    console.warn(`electron-glasskit: no native binary for darwin-${process.arch}; glass is disabled.`);
    return inert;
  }
  try {
    return createRequire(import.meta.url)(file);
  } catch (error) {
    console.warn("electron-glasskit: the native binary failed to load; glass is disabled.", error);
    return inert;
  }
}

let binding: NativeBinding | undefined;

export function getNative(): NativeBinding {
  binding ??= load();
  return binding;
}

/** Replaces the addon, for tests. `undefined` restores normal loading. */
export function setNative(replacement: NativeBinding | undefined): void {
  binding = replacement;
}
