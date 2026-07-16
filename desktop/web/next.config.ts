import type { NextConfig } from "next";

// The desktop renderer as a static Next export (ADR-139). No server: `next
// build` prerenders client pages to static HTML+JS that Electron loads via a
// custom `app://` protocol. Pages fetch at runtime through the seam
// (window.__ledgrDesktop → IPC → @/lib → PGlite), so prerender only produces
// the loading shell. `externalDir` lets pages import the shared UI from ../../src.
const config: NextConfig = {
  output: "export",
  distDir: "out",
  images: { unoptimized: true },
  experimental: { externalDir: true },
  // The shared src tree is type-checked by the root project; skip here so the
  // desktop export build isn't gated on the whole app's types.
  typescript: { ignoreBuildErrors: true },
};

export default config;
