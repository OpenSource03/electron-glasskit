import { defineConfig, type UserConfig } from "tsdown";

const shared = {
  format: ["esm", "cjs"],
  dts: true,
  outDir: "dist",
  target: "es2023",
  // `.js` and `.cjs` everywhere, matching the export map.
  fixedExtension: false,
} satisfies UserConfig;

const config: UserConfig[] = defineConfig([
  {
    ...shared,
    entry: { index: "src/index.ts" },
    platform: "node",
    external: ["electron"],
    shims: true,
    clean: true,
  },
  {
    // Sandboxed preload scripts cannot load other files, so this bundle stands alone.
    ...shared,
    entry: { preload: "src/preload/index.ts" },
    platform: "node",
    external: ["electron"],
    clean: false,
  },
  {
    ...shared,
    entry: { renderer: "src/renderer/index.ts", react: "src/react/index.ts" },
    platform: "browser",
    external: ["react", "react/jsx-runtime"],
    clean: false,
  },
]);

export default config;
