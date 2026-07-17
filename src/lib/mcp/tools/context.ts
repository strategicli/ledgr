// Live editing context tools (ADR-162): the MCP side of the Notion-style
// co-editing loop. get_active_context tells Claude which note the owner is
// looking at right now (and what they've highlighted); edit_item_body makes a
// surgical, single-spot change to a note's markdown without resending the whole
// body. Both are gated by settings.liveContextEnabled (see
// LIVE_CONTEXT_TOOL_NAMES and its use in index.ts) — off by default, so a
// vanilla MCP client never sees them.
//
// Thin wrappers over the same owner-scoped libs the app uses (active-context.ts,
// items.ts, item-mutations.ts), so this surface can't drift from the app
// contract or skip owner-scoping.
import { asUuid } from "@/lib/api";
import { bodyMarkdown, makeMarkdownBody } from "@/lib/body";
import { ItemError, getItem } from "@/lib/items";
import { updateItem } from "@/lib/item-mutations";
import { getActiveContext } from "@/lib/active-context";
import { rowView } from "./serializers";
import type { McpTool } from "./wire";

// Present only when the owner has turned on Live editing context. Filtered out of
// tools/list and rejected by callTool when off — same posture as the memory
// tools (ADR-137).
export const LIVE_CONTEXT_TOOL_NAMES = [
  "get_active_context",
  "edit_item_body",
] as const;

// Whole seconds since a timestamp, for the staleness hints.
function ageSeconds(when: Date): number {
  return Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
}

// A short window of body text around an index, for an edit's confirmation snippet.
function snippetAround(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + len + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export const contextTools: McpTool[] = [
  {
    name: "get_active_context",
    title: "Get the note the owner is looking at",
    description:
      "Resolve deictic references — \"this note\", \"this page\", \"the draft\", " +
      "\"this\", \"it\" — to whatever the owner CURRENTLY has open in Ledgr, plus " +
      "any text they've highlighted (\"this sentence\", \"rework this\"). Returns " +
      "the open item's id, title, and FRESHLY-READ markdown body, and the current " +
      "selection when there is one. Call this at the START of a note-editing turn, " +
      "and AGAIN whenever the owner refers to the current note or asks what you " +
      "think of it — the owner edits directly with keyboard and mouse, so the body " +
      "you saw earlier may be stale; always re-read rather than trusting a cached " +
      "copy. contextAgeSeconds/selectionAgeSeconds tell you how fresh this is; a " +
      "large age means the owner may have moved on. Returns active:false when no " +
      "note is open. To change the note, use edit_item_body (surgical) rather than " +
      "update_item (whole-body).",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId) => {
      const ctx = await getActiveContext(ownerId);
      if (!ctx || !ctx.itemId) {
        return {
          active: false,
          message:
            "No note is currently open in Ledgr. Ask the owner to open the note " +
            "they want to work on, or find it with search_items.",
        };
      }
      // Re-read the item fresh — the whole point is current state, not what was
      // reported. A just-deleted/again-moved item reads as no active context.
      let item;
      try {
        item = await getItem(ownerId, ctx.itemId);
      } catch {
        return {
          active: false,
          message:
            "The note that was open is no longer available (it may have been " +
            "deleted). Ask the owner which note to work on.",
        };
      }
      if (item.deletedAt) {
        return {
          active: false,
          message: "The note that was open is in the Trash.",
        };
      }
      const selection =
        ctx.selectionText && ctx.selectionAt
          ? { text: ctx.selectionText, ageSeconds: ageSeconds(ctx.selectionAt) }
          : null;
      return {
        active: true,
        contextAgeSeconds: ageSeconds(ctx.updatedAt),
        item: { ...rowView(item), body: bodyMarkdown(item.body) },
        selection,
        hint:
          "Re-read with get_active_context whenever the owner references the note " +
          "again. Make changes with edit_item_body so you touch only the right " +
          "spot; confirm before writing unless told to go ahead.",
      };
    },
  },
  {
    name: "edit_item_body",
    title: "Make a surgical edit to a note's body",
    description:
      "Change ONE spot in an item's markdown body by exact find-and-replace, " +
      "without resending the whole body — the safe way to edit a note the owner " +
      "is also editing by hand, since it touches only the matched text and leaves " +
      "everything else (including their concurrent edits elsewhere) intact. `find` " +
      "must match EXACTLY ONE place in the current body (include enough " +
      "surrounding words to be unique — e.g. the whole sentence from " +
      "get_active_context's selection); if it matches several, the call errors so " +
      "you can add context or pass all=true to replace every occurrence. `replace` " +
      "may be an empty string to delete the matched text. Re-read the body first " +
      "(get_active_context or get_item) so `find` reflects the note's current " +
      "state. For a whole-note rewrite, update_item is still the right tool.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item id (UUID)." },
        find: {
          type: "string",
          description:
            "The exact text to replace, as it appears in the current markdown body. Must be unique unless all=true.",
        },
        replace: {
          type: "string",
          description: "The replacement text (may be an empty string to delete the matched text).",
        },
        all: {
          type: "boolean",
          description:
            "Replace every occurrence of `find` instead of requiring a single unique match. Default false.",
        },
      },
      required: ["id", "find", "replace"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      if (typeof args.find !== "string" || args.find === "") {
        throw new ItemError("bad_request", "find must be a non-empty string");
      }
      if (typeof args.replace !== "string") {
        throw new ItemError("bad_request", "replace must be a string (use \"\" to delete the matched text)");
      }
      const find = args.find;
      const replace = args.replace;
      const all = args.all === true;

      const item = await getItem(ownerId, id);
      if (item.deletedAt) throw new ItemError("not_found", "item not found");
      const markdown = bodyMarkdown(item.body);
      const occurrences = markdown.split(find).length - 1;
      if (occurrences === 0) {
        throw new ItemError(
          "not_found",
          "the text to find isn't in the note's current body — re-read it with " +
            "get_active_context/get_item; the owner may have changed it since you last saw it"
        );
      }
      if (occurrences > 1 && !all) {
        throw new ItemError(
          "bad_request",
          `"find" matches ${occurrences} places — include more surrounding text to ` +
            "make it unique, or pass all=true to replace every occurrence"
        );
      }
      const firstIndex = markdown.indexOf(find);
      const next = all
        ? markdown.split(find).join(replace)
        : markdown.slice(0, firstIndex) + replace + markdown.slice(firstIndex + find.length);
      const updated = await updateItem(ownerId, id, { body: makeMarkdownBody(next) });
      return {
        ...rowView(updated),
        replacements: all ? occurrences : 1,
        snippet: snippetAround(next, firstIndex, replace.length),
      };
    },
  },
];
