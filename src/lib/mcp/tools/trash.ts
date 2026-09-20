// Trash tools (ADR-267): move items to Trash and bring them back, over MCP.
//
// The app has had soft-delete since slice 6 — Trash, a 30-day purge, cascade to
// live children, a matching restore — and the in-app routes (DELETE /api/items/
// [id], POST /api/items/[id]/restore, DELETE /api/items/batch) have called it
// the whole time. Nothing let an assistant reach it: an agent that filed a
// duplicate or an import gone wrong had no way to undo its own work short of
// asking the owner to click through Trash. These are thin wrappers over the
// same softDeleteItem / restoreItem, so a delete here is exactly the delete
// the app does: soft, reversible, never a hard delete (CLAUDE.md: soft-delete
// only; the purge is a machine job, not a tool).
import { asUuid } from "@/lib/api";
import { restoreItem, softDeleteItem } from "@/lib/item-mutations";
import { ItemError } from "@/lib/items";
import { optUuidArray } from "./args";
import type { McpTool } from "./wire";

export const MAX_TRASH_BATCH = 100;

// One id or a list, into one list. `id` and `ids` may both be given.
function collectIds(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (args.id !== undefined && args.id !== null) out.push(asUuid(args.id, "id"));
  out.push(...optUuidArray(args, "ids"));
  const unique = Array.from(new Set(out));
  if (unique.length === 0) {
    throw new ItemError("bad_request", "pass an item id (`id`) or a list of them (`ids`)");
  }
  if (unique.length > MAX_TRASH_BATCH) {
    throw new ItemError("bad_request", `too many ids (max ${MAX_TRASH_BATCH} per call)`);
  }
  return unique;
}

type Outcome = { id: string; ok: true; count: number } | { id: string; ok: false; error: string };

// Apply one soft operation per id, reporting each outcome instead of stopping
// at the first failure — a batch delete where one id was already in Trash
// should still trash the rest and say which one it skipped.
async function eachId(
  ids: string[],
  op: (id: string) => Promise<number>
): Promise<{ results: Outcome[]; succeeded: number; failed: number }> {
  const results: Outcome[] = [];
  for (const id of ids) {
    try {
      results.push({ id, ok: true, count: await op(id) });
    } catch (err) {
      if (!(err instanceof ItemError)) throw err;
      results.push({ id, ok: false, error: err.message });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}

export const trashTools: McpTool[] = [
  {
    name: "delete_item",
    title: "Move item to Trash",
    description:
      "Move one item (`id`) or several (`ids`) to Trash. This is the app's own " +
      "delete: SOFT and reversible — the item disappears from every list and " +
      "search, sits in Trash for 30 days, and restore_item brings it back with " +
      "its children. Live children (subtasks, child pages) go to Trash with " +
      "their parent as one unit. Nothing is hard-deleted here; the 30-day purge " +
      "is the only thing that removes rows. Use this to undo your own mistake " +
      "(a duplicate, an import that landed wrong) without asking the owner to " +
      "click through Trash. Each id is reported on its own, so one already-" +
      "trashed id does not stop the rest.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item to trash (UUID)." },
        ids: { type: "array", items: { type: "string" }, description: "Several items to trash (UUIDs, max 100). May be combined with `id`." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const ids = collectIds(args);
      const { results, succeeded, failed } = await eachId(ids, async (id) => {
        const r = await softDeleteItem(ownerId, id);
        return r.deleted;
      });
      return {
        trashed: succeeded,
        failed,
        // `count` on a result is how many rows went to Trash for that id: the
        // item plus the live children that went with it.
        results,
        note: "Soft-deleted: in Trash for 30 days. restore_item with the same id undoes it.",
      };
    },
  },
  {
    name: "restore_item",
    title: "Restore from Trash",
    description:
      "Bring one item (`id`) or several (`ids`) back from Trash, along with " +
      "the children that were trashed with it in the same delete. An id that " +
      "is not in Trash is reported as such and the rest still restore. If the " +
      "item's TYPE was also in Trash, restoring the item revives the type.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The trashed item to restore (UUID)." },
        ids: { type: "array", items: { type: "string" }, description: "Several trashed items to restore (UUIDs, max 100). May be combined with `id`." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const ids = collectIds(args);
      const { results, succeeded, failed } = await eachId(ids, async (id) => {
        const r = await restoreItem(ownerId, id);
        return r.restored;
      });
      return { restored: succeeded, failed, results };
    },
  },
];
