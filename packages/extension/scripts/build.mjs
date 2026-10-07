import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const src = join(root, "src");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "icon"), { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(src, "background.ts")],
  outfile: join(dist, "background.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  legalComments: "none",
});

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(src, "options.ts")],
  outfile: join(dist, "options.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  legalComments: "none",
});

cpSync(join(src, "options.html"), join(dist, "options.html"));
cpSync(join(src, "options.css"), join(dist, "options.css"));
cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "icon"), join(dist, "icon"), { recursive: true });

console.log("extension → packages/extension/dist");
