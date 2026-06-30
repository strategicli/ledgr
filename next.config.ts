import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep CSS in import order; do NOT remove this. Next's default (`true`, loose)
  // merges and reorders CSS chunks to minimize their count, which races our
  // per-component stylesheets (Tiptap's markdown-editor.css, react-grid-layout's
  // CSS — both imported inside dynamically-loaded client components) against
  // globals.css. When a component chunk wins that race, Tailwind's `@layer base`
  // (preflight + color-scheme) loses the cascade and the page renders with
  // native light-mode controls and stray borders — the intermittent
  // "randomly unstyled content" / dark-scrollbar flash that a refresh would
  // toggle on or off. 'strict' preserves import order so the base layer always
  // wins. (Paired with an explicit `color-scheme: dark` on :root in globals.css.)
  experimental: {
    cssChunking: "strict",
  },
  async rewrites() {
    return [
      // OAuth discovery (ADR-117). The metadata is origin-dependent (it
      // advertises this deploy's authorize/token endpoints), so it's served by
      // dynamic route handlers, not static files; the app router ignores
      // dot-prefixed folders, so these RFC 9728 / RFC 8414 well-known paths are
      // rewritten onto normal /api/oauth routes. Both targets are in the
      // proxy.ts public set; the /.well-known paths are too (middleware sees the
      // pre-rewrite path).
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth/protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth/authorization-server",
      },
      // Some clients probe the resource-scoped variant
      // (…/oauth-protected-resource/<resource-path>); point the /api/mcp one at
      // the same handler.
      {
        source: "/.well-known/oauth-protected-resource/api/mcp",
        destination: "/api/oauth/protected-resource",
      },
    ];
  },
};

export default nextConfig;
