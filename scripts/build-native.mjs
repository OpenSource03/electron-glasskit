#!/usr/bin/env node
// Builds the native addon: Swift into a static library, then node-gyp links it with the N-API shim.
// Usage: node scripts/build-native.mjs [--arch arm64,x64] [--debug]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const native = path.join(root, "native");
const DEPLOYMENT_TARGET = "12.0";
const SWIFT_ARCH = { arm64: "arm64", x64: "x86_64" };

if (process.platform !== "darwin") {
  console.log("electron-glasskit: the native addon is macOS only; nothing to build on this platform.");
  process.exit(0);
}

const { values } = parseArgs({
  options: { arch: { type: "string", default: process.arch }, debug: { type: "boolean", default: false } },
});
const archs = values.arch.split(",").map((arch) => arch.trim());
for (const arch of archs) {
  if (!(arch in SWIFT_ARCH)) throw new Error(`Unsupported architecture "${arch}". Use arm64 or x64.`);
}

const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });
const nodeGyp = createRequire(import.meta.url).resolve("node-gyp/bin/node-gyp.js");
const sources = readdirSync(path.join(native, "swift"), { recursive: true })
  .filter((file) => file.endsWith(".swift"))
  .map((file) => path.join("swift", file))
  .sort();

for (const arch of archs) {
  const libraryDir = path.join(native, ".build", arch);
  mkdirSync(libraryDir, { recursive: true });

  console.log(`\n▸ Swift (${arch})`);
  run(
    "xcrun",
    [
      "swiftc",
      "-swift-version",
      "6",
      "-parse-as-library",
      "-module-name",
      "GlassKitNative",
      "-target",
      `${SWIFT_ARCH[arch]}-apple-macos${DEPLOYMENT_TARGET}`,
      ...(values.debug ? ["-Onone", "-g"] : ["-O", "-whole-module-optimization"]),
      "-emit-library",
      "-static",
      "-o",
      path.join(libraryDir, "libGlassKitSwift.a"),
      ...sources,
    ],
    native,
  );

  console.log(`\n▸ Addon (${arch})`);
  run(process.execPath, [
    nodeGyp,
    "rebuild",
    "--directory",
    native,
    "--arch",
    arch,
    ...(values.debug ? ["--debug"] : []),
  ]);

  const built = path.join(native, "build", values.debug ? "Debug" : "Release", "glasskit.node");
  const prebuilt = path.join(root, "prebuilds", `darwin-${arch}`, "glasskit.node");
  mkdirSync(path.dirname(prebuilt), { recursive: true });
  copyFileSync(built, prebuilt);
  if (!values.debug) run("strip", ["-x", prebuilt]);
  console.log(`\n✓ ${path.relative(root, prebuilt)}`);
}
