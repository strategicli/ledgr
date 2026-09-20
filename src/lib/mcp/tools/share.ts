// Share-link tools: thin wrappers over src/lib/share.ts, the same owner-scoped
// functions the item's Share control and /api/items/[id]/share use. Additive
// MCP surface (ADR-183 carve-out). Views are not counted: the public page is
// CDN-cached, so an origin hit count would undercount anyway.
import { asUuid } from "@/lib/api";
import { ItemError } from "@/lib/items";
import { createShareToken, listShareTokens, revokeShareToken, type ShareOptions } from "@/lib/share";
import { THEMES } from "@/lib/settings";
import { optEnum, optString } from "./args";
import type { McpTool } from "./wire";

function origin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://ledgr-teal.vercel.app").replace(/\/+$/, "");
}

function shareUrl(token: string): string {
  return `${origin()}/share/${token}`;
}

export const shareTools: McpTool[] = [
  {
    name: "share_item",
    title: "Share item",
    description:
      "Mint a public, read-only share link for one item: an unguessable URL that " +
      "needs no sign-in, showing the item's printed document (no app chrome, no " +
      "comments, no navigation into anything else). Each call makes a fresh link, " +
      "so one leaked link can be revoked without disturbing others. Drop the " +
      "returned url into an email, a Teams message, or another item's body. " +
      "Options ride the link: theme picks the look the page opens in (default: the " +
      "owner's), showIcons=false hides the type icons on @-mentions.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item to share (UUID)." },
        theme: { type: "string", enum: [...THEMES], description: "Theme the shared page opens in. Omit for the owner's current theme." },
        showIcons: { type: "boolean", description: "Show type icons on @-mentions. Default true." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const theme = optEnum(args, "theme", THEMES);
      const options: ShareOptions = {
        ...(args.showIcons === false ? { showIcons: false } : {}),
        ...(theme ? { theme } : {}),
      };
      // lib/share rejects with a plain Error; surface it as the MCP not_found shape.
      const row = await createShareToken(ownerId, id, options).catch((err: unknown) => {
        if (err instanceof Error && err.message === "item not found") throw new ItemError("not_found", "item not found");
        throw err;
      });
      return { itemId: id, url: shareUrl(row.token), token: row.token, options: row.options, createdAt: row.createdAt.toISOString() };
    },
  },
  {
    name: "list_share_links",
    title: "List share links",
    description:
      "Is this item shared? Lists every share link ever minted for one item, newest " +
      "first, with its url, options, createdAt and revokedAt. `shared` is true when at " +
      "least one link is still live; activeCount/revokedCount summarize the rest. " +
      "Ledgr does not count how many times a link was opened.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The item (UUID)." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const rows = await listShareTokens(ownerId, id);
      const links = rows.map((r) => ({
        url: shareUrl(r.token),
        token: r.token,
        options: r.options,
        createdAt: r.createdAt.toISOString(),
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      }));
      const activeCount = links.filter((l) => !l.revokedAt).length;
      return { itemId: id, shared: activeCount > 0, activeCount, revokedCount: links.length - activeCount, links };
    },
  },
  {
    name: "revoke_share_link",
    title: "Revoke share link",
    description:
      "Kill a share link so its URL stops working (within about a minute at the CDN " +
      "edge). Pass token (or the full url) to revoke one link, or id alone to revoke " +
      "every live link on that item. Idempotent; revoking is not undoable but a new " +
      "link can always be minted with share_item.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "The link's token, or its full /share/<token> url." },
        id: { type: "string", description: "Item (UUID). With no token, revokes ALL its live links." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const raw = optString(args, "token");
      if (raw) {
        const token = raw.replace(/^.*\/share\//, "").replace(/[?#].*$/, "");
        const revoked = await revokeShareToken(ownerId, token);
        return { revoked: revoked ? 1 : 0, token };
      }
      const id = asUuid(args.id, "id");
      const live = (await listShareTokens(ownerId, id)).filter((r) => !r.revokedAt);
      let revoked = 0;
      for (const r of live) if (await revokeShareToken(ownerId, r.token)) revoked++;
      return { itemId: id, revoked };
    },
  },
];
