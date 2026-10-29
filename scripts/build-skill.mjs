// Builds dist/skills/sf-factory: the skill's markdown, the bundled host script
// (server + CLI, no runtime dependencies), and the UI (built by `vite build`).
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist/skills/sf-factory");

for (const entry of fs.readdirSync(path.join(root, "skills/sf-factory"))) {
  fs.cpSync(path.join(root, "skills/sf-factory", entry), path.join(out, entry), { recursive: true });
}

await build({
  entryPoints: [path.join(root, "src/cli/main.ts")],
  outfile: path.join(out, "scripts/sf-factory.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Express is CommonJS and calls require() for Node built-ins.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

if (!fs.existsSync(path.join(out, "assets/ui/index.html")))
  console.warn("warning: no UI build found; run `vite build` first");
console.log(`built ${path.relative(root, out)}`);
