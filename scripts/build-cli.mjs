// Bundles the CLI and ships the built skills next to it (run after build-skill).
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist/cli");
const skills = path.join(root, "dist/skills");
if (!fs.existsSync(skills)) throw new Error("dist/skills is missing; run `pnpm build` from the repository root");

await build({
  entryPoints: [path.join(root, "src/cli/setup.ts")],
  outfile: path.join(out, "sf.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
fs.rmSync(path.join(out, "skills"), { recursive: true, force: true });
fs.cpSync(skills, path.join(out, "skills"), { recursive: true });
console.log("built dist/cli");
