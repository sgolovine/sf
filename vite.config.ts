import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const web = path.resolve(import.meta.dirname, "src/web");

// In development the Express server runs separately (`pnpm dev:server`, port 4317)
// and Vite proxies /api to it. `pnpm build` writes the UI to dist/ui, which `sf start` serves.
export default defineConfig({
  root: web,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": web },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/ui"),
    emptyOutDir: true,
  },
});
