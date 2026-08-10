import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../web/src"),
      "@openkeep/sdk": path.resolve(__dirname, "../../packages/sdk/src/index.ts"),
      "@openkeep/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
