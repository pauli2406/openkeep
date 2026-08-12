import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@openkeep/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: ["electron"],
    },
  },
});
