import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the Express server runs separately (`pnpm dev:server`, port 4317)
// and Vite proxies /api to it. `pnpm build` writes the UI into the bundled skill.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317" },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "../../dist/skills/sf-factory/assets/ui"),
    emptyOutDir: true,
  },
});
