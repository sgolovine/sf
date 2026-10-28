// Bundles the CLI and ships the built skills next to it (run after build-skill).
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const here = import.meta.dirname;
const skills = path.resolve(here, "../../dist/skills");
if (!fs.existsSync(skills)) throw new Error("dist/skills is missing; run `pnpm build` from the repository root");

await build({
  entryPoints: [path.join(here, "src/sf.ts")],
  outfile: path.join(here, "dist/sf.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
fs.rmSync(path.join(here, "dist/skills"), { recursive: true, force: true });
fs.cpSync(skills, path.join(here, "dist/skills"), { recursive: true });
console.log("built packages/cli/dist");
