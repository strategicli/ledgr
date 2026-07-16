// Bundle the Electron main + preload from TypeScript. Choices (ADR-139):
// (1) bundle @/lib + its deps INTO main.js so a packaged app needs no repo
// node_modules; only `electron` (runtime-provided) and `@electric-sql/pglite`
// (ships its WASM as an unpacked node_module) stay external. (2) tsconfig
// `paths` resolve `@/*` → ../src and alias `server-only` → ./empty.ts, so
// @/lib runs in the plain-Node main process.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron", "@electric-sql/pglite", "@electric-sql/pglite/*"],
  tsconfig: "./tsconfig.json",
  logLevel: "info",
  sourcemap: true,
};

await build({
  ...common,
  entryPoints: ["main/index.ts"],
  outfile: "dist/main.js",
});

await build({
  ...common,
  entryPoints: ["preload/index.ts"],
  outfile: "dist/preload.js",
});

console.log("desktop build ok → dist/main.js, dist/preload.js");
