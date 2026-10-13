#!/usr/bin/env node
// Launches the kitchen-sink example against the local build.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(path.join(root, "dist/index.js"))) {
  console.error("Build first: pnpm build:all");
  process.exit(1);
}

const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
// Inherited from Electron-based terminals and editors; it would make Electron behave as plain Node.
delete env.ELECTRON_RUN_AS_NODE;

spawn(electron, [path.join(root, "examples/kitchen-sink/main.mjs")], { cwd: root, env, stdio: "inherit" }).on(
  "exit",
  (code) => process.exit(code ?? 0),
);
