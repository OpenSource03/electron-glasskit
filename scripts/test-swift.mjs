#!/usr/bin/env node
// Compiles the Swift sources together with the test runner in native/swift-tests and runs it.
//
//   node scripts/test-swift.mjs                                   build for this Mac and run the tests
//   node scripts/test-swift.mjs --target x86_64-apple-macos12.0   only type-check for another target

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectories = ["native/swift/Core", "native/swift/Islands", "native/swift/Support", "native/swift-tests"];
const DEPLOYMENT_TARGET = "12.0";

function swiftSources() {
  return sourceDirectories.flatMap((directory) =>
    readdirSync(join(root, directory))
      .filter((name) => name.endsWith(".swift"))
      .sort()
      .map((name) => join(root, directory, name)),
  );
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function parseTarget(args) {
  const index = args.indexOf("--target");
  if (index === -1) return null;
  const target = args[index + 1];
  if (!target) {
    console.error("--target needs a triple, for example x86_64-apple-macos12.0");
    process.exit(2);
  }
  return target;
}

if (process.platform !== "darwin") {
  console.log("Swift tests need macOS; skipping.");
  process.exit(0);
}

const swiftc = ["swiftc", "-swift-version", "6", "-warnings-as-errors"];
const target = parseTarget(process.argv.slice(2));

if (target) {
  const status = run("xcrun", [...swiftc, "-typecheck", "-target", target, ...swiftSources()]);
  if (status === 0) console.log(`Type-checked for ${target}.`);
  process.exit(status);
}

const hostTarget = `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos${DEPLOYMENT_TARGET}`;
const buildDirectory = mkdtempSync(join(tmpdir(), "glasskit-swift-tests-"));
let status = 1;
try {
  const binary = join(buildDirectory, "island-tests");
  status = run("xcrun", [...swiftc, "-target", hostTarget, "-o", binary, ...swiftSources()]);
  if (status === 0) status = run(binary, []);
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}
process.exit(status);
