#!/usr/bin/env node
// Runs the end-to-end suite inside Electron against the built package and the real native addon.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "darwin") {
  console.log("electron-glasskit: the end-to-end suite needs macOS; skipping.");
  process.exit(0);
}

// `require("electron")` outside Electron resolves to the path of its binary.
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
// Inherited from Electron-based terminals and editors; it would make Electron behave as plain Node.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(root, "test/e2e/main.mjs"), ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});
const timeout = setTimeout(() => {
  console.error("The end-to-end suite timed out.");
  child.kill("SIGKILL");
}, 180_000);
child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  process.exit(code ?? (signal ? 1 : 0));
});
