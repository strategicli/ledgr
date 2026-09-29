// /api/machine/website-pages (the Website Pages module).
//   GET   every page: { pages: [{ id, title, url, design, published: [...] }],
//         options: { languages, palettes, fonts, starters } }
//   POST  create a page: { title, starter?, design?: {language, palette, font},
//         body?, share? (default true) } → { id, title, design, url }
// The full reference (blocks, settings, rules) is the MCP resource
// ledgr://guide/website-pages and /build/api.
import { verifyApiRequest } from "@/lib/auth/credentials";
import { json, preflight, withMachineOwner } from "@/modules/website-pages/lib/machine";
import { createSite, describeSites, designOptions, PublishError } from "@/modules/website-pages/lib/service";
import type { Design } from "@/modules/website-pages/lib/theme";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(request: Request) {
  if (!(await verifyApiRequest(request.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  return withMachineOwner(request, async (ownerId, origin) => ({
    pages: await describeSites(ownerId, origin),
    options: designOptions(),
  }));
}

export async function POST(request: Request) {
  if (!(await verifyApiRequest(request.headers.get("authorization")))) return json({ error: "unauthorized" }, 401);
  return withMachineOwner(request, async (ownerId, origin) => {
    const b = (await request.json().catch(() => ({}))) as {
      title?: unknown; starter?: unknown; design?: unknown; body?: unknown; share?: unknown;
    };
    if (typeof b.title !== "string" || !b.title.trim()) throw new PublishError("title is required");
    return createSite(
      ownerId,
      {
        title: b.title.trim(),
        starter: typeof b.starter === "string" ? b.starter : undefined,
        design: b.design && typeof b.design === "object" ? (b.design as Partial<Design>) : undefined,
        body: typeof b.body === "string" ? b.body : undefined,
        share: b.share !== false,
      },
      origin
    );
  });
}
