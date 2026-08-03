import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // The smoke tests drive real interactions through MSW and Radix portals.
    // They finish in ~2s on an idle machine but sit close to the 5s default
    // when `turbo test` runs every package at once.
    testTimeout: 20_000,
  },
});
