import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    include: ["test/unit/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});

export default config;
