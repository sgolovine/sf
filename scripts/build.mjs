// Bundles the sf CLI (server + commands) into dist/sf.mjs. Run after `vite build`,
// which writes the UI to dist/ui; dist/sf.mjs serves it from there.
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist/sf.mjs");

await build({
  entryPoints: [path.join(root, "src/cli/main.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Express is CommonJS and calls require() for Node built-ins.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
fs.chmodSync(out, 0o755);

if (!fs.existsSync(path.join(root, "dist/ui/index.html")))
  console.warn("warning: dist/ui is missing; run `vite build` first");
console.log("built dist/sf.mjs");
