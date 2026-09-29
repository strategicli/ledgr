// Website Pages tools for assistants: thin wrappers over ./service.ts, the same
// owner-scoped operations the page controls and the machine HTTP API call. The
// full how-to (blocks, settings, looks, publishing rules) is the resource
// ledgr://guide/website-pages; each description points at it.
import { asUuid } from "@/lib/api";
import { optString } from "@/lib/mcp/tools/args";
import type { McpTool } from "@/lib/mcp/tools/wire";
import { publicShareOrigin } from "@/modules/sharing/lib/share";
import { publishToPage, unpublishFromPage } from "@/modules/website-pages/lib/publish";
import { applyStarter, createSite, describeSites, designOptions, setDesign } from "@/modules/website-pages/lib/service";
import { FONTS, LANGUAGES, PALETTES, type Design } from "@/modules/website-pages/lib/theme";
import { STARTERS } from "@/modules/website-pages/lib/starters";

async function origin(ownerId: string): Promise<string> {
  return (await publicShareOrigin(ownerId)) ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://ledgr-teal.vercel.app";
}

const designArgs = {
  language: { type: "string", enum: Object.keys(LANGUAGES), description: "Style: modern, minimal, bold, warm or editorial." },
  palette: { type: "string", enum: Object.keys(PALETTES), description: "Colors: slate, navy, forest, dusk or tide." },
  font: { type: "string", enum: Object.keys(FONTS), description: "Font. Omit to use the style's own font." },
} as const;

function designFrom(args: Record<string, unknown>): Partial<Design> {
  const d: Partial<Design> = {};
  for (const k of ["language", "palette", "font"] as const) {
    const v = optString(args, k);
    if (v) d[k] = v;
  }
  return d;
}

export const websitePageTools: McpTool[] = [
  {
    name: "list_website_pages",
    title: "List website pages",
    description:
      "Every Website Page (a site's home) with its public link (null until shared), its look " +
      "{language, palette, font}, and everything published to it (title, type, tags, date, " +
      "subpage url). Read ledgr://guide/website-pages for how pages, blocks and publishing work.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId) => ({ pages: await describeSites(ownerId, await origin(ownerId)) }),
  },
  {
    name: "page_design_options",
    title: "Page design options",
    description:
      "The styles, color palettes, fonts and starters a Website Page can use, each with the " +
      "reasoning the owner sees in the picker. Use it to recommend a look that fits the page.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async () => designOptions(),
  },
  {
    name: "create_website_page",
    title: "Create website page",
    description:
      "Make a new Website Page (a site's home). Pass starter to begin from sample sections " +
      `(${STARTERS.map((s) => s.id).join(", ")}), or body to write the markdown yourself ` +
      "(blocks like ::: hero … :::, see ledgr://guide/website-pages). Optional look. Shared by " +
      "default (share=false to skip); returns the id and public url. Then publish the owner's " +
      "existing items to it with publish_to_page rather than copying their text in.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The site's name, shown in its header." },
        starter: { type: "string", enum: STARTERS.map((s) => s.id), description: "Begin from this starter's sample sections and look." },
        body: { type: "string", description: "The page's markdown, if not using a starter." },
        ...designArgs,
        share: { type: "boolean", description: "Make a public link now. Default true." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const title = optString(args, "title");
      if (!title) throw new Error("title is required");
      const design = designFrom(args);
      return createSite(
        ownerId,
        {
          title,
          starter: optString(args, "starter"),
          body: optString(args, "body"),
          design: Object.keys(design).length ? design : undefined,
          share: args.share !== false,
        },
        await origin(ownerId)
      );
    },
  },
  {
    name: "set_page_design",
    title: "Set page design",
    description:
      "Change a Website Page's look: any of language (style), palette (colors) and font. The " +
      "look is a setting, never the markdown, and applies to every page of that site. Changing " +
      "the language without a font switches to that language's own font. Optionally fill an " +
      "EMPTY page from a starter in the same call (refused if the page has content).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The Website Page (UUID)." },
        ...designArgs,
        starter: { type: "string", enum: STARTERS.map((s) => s.id), description: "Fill the empty page from this starter first." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const starter = optString(args, "starter");
      if (starter) await applyStarter(ownerId, id, starter);
      const design = designFrom(args);
      return { id, design: await setDesign(ownerId, id, design) };
    },
  },
  {
    name: "publish_to_page",
    title: "Publish to page",
    description:
      "Put an item on a site: it gets its own page under the site's link and can appear in the " +
      "page's collections. Publishing is the ONLY way anything reaches a site (tags never publish). " +
      "Re-publishing keeps the item's address and date. Returns its slug and publish date.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item to publish (UUID)." },
        pageId: { type: "string", description: "The Website Page to publish it on (UUID)." },
      },
      required: ["id", "pageId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const pub = await publishToPage(ownerId, asUuid(args.pageId, "pageId"), asUuid(args.id, "id"));
      return { published: true, slug: pub.slug, publishedAt: pub.at };
    },
  },
  {
    name: "unpublish_from_page",
    title: "Unpublish from page",
    description:
      "Take an item off a site. Its page address stops working at once (within about a minute " +
      "at the edge cache); the item itself is untouched. Idempotent.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item (UUID)." },
        pageId: { type: "string", description: "The Website Page (UUID)." },
      },
      required: ["id", "pageId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      await unpublishFromPage(ownerId, asUuid(args.pageId, "pageId"), asUuid(args.id, "id"));
      return { published: false };
    },
  },
];
