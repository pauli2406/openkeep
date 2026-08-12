import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const DEV_SERVER_PORT = 5174;

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "openkeep-desktop-csp",
      transformIndexHtml(html) {
        const developmentSocket =
          command === "serve" ? ` ws://127.0.0.1:${DEV_SERVER_PORT}` : "";
        return html.replace("__OPENKEEP_DEVELOPMENT_SOCKET__", developmentSocket);
      },
    },
  ],
  publicDir: path.resolve(__dirname, "../web/public"),
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../web/src"),
      "@openkeep/sdk": path.resolve(__dirname, "../../packages/sdk/src/index.ts"),
      "@openkeep/types": path.resolve(__dirname, "../../packages/types/src/index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: DEV_SERVER_PORT,
    strictPort: true,
    hmr: {
      host: "127.0.0.1",
      port: DEV_SERVER_PORT,
      clientPort: DEV_SERVER_PORT,
      protocol: "ws",
    },
    fs: {
      allow: [
        path.resolve(__dirname, "../web"),
        path.resolve(__dirname, "../../packages"),
        __dirname,
      ],
    },
  },
}));
