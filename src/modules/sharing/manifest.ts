// Public share links (slice 31, PRD §4.12) as a module (ADR-272 step 4). Pure:
// the proxy and the client sidebar import this through register.ts, so nothing
// here reaches the database. The MCP tool definitions are attached on the
// server by ./server.ts. The `share_tokens` table stays in src/db/schema.ts and
// is owned by this module; turning it off keeps every token, it just stops
// answering (each route calls the gate in src/lib/modules/gate.ts).
import type { ModuleManifest } from "@/lib/modules";

export const sharingModule: ModuleManifest = {
  id: "sharing",
  label: "Sharing",
  description:
    "Public, read-only links to a single item that anyone with the link can open without signing in.",
  enabledByDefault: true,
  types: [],
  exporters: [],
  mcpTools: { names: ["share_item", "list_share_links", "revoke_share_link"] },
  // The public render takes no session: an unguessable token is the credential.
  // Issuance (/api/items/[id]/share) stays behind sign-in. The `(.*)` matters:
  // a bare "/share" would match only the empty path, not /share/<token>.
  publicPaths: ["/share(.*)"],
  routes: ["src/app/share/[token]/route.ts", "src/app/api/items/[id]/share/route.ts"],
};
