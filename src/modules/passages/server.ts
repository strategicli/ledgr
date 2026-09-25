// Server-only slots for the passages module (ADR-272 step 4). Imported for
// effect by `src/lib/modules/server-slots.ts`, never by the pure path.
import { allModules } from "@/lib/modules";
import "@/lib/modules/register";

const m = allModules().find((x) => x.id === "passages");
if (m && !m.hooks) {
  m.hooks = {
    // Rebuild the item's passage_refs from the saved body. Runs on a cleared
    // body too: clearing a body clears its edges. The sync apply path passes
    // its transaction as `db`, so a synced row and its edges commit together.
    onBodySave: async ({ ownerId, itemId, body, db }) => {
      const { replacePassageRefs, syncPassageRefs } = await import("@/modules/passages/lib/refs");
      if (db) await replacePassageRefs(db, itemId, body);
      else await syncPassageRefs(ownerId, itemId, body);
    },
  };
}
