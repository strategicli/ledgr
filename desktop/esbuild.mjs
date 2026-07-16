// Bundle the Electron main + preload from TypeScript. Two deliberate choices
// (ADR-139): (1) `packages: "external"` leaves node_modules (drizzle, pglite,
// electron, …) to be required at runtime from the repo's node_modules — no WASM
// bundling; (2) tsconfig `paths` resolve `@/*` → ../src and alias `server-only`
// → ./empty.ts, so @/lib runs in the plain-Node main process.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
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
