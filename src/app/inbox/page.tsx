// Inbox (PRD §4.2): items that arrived untriaged, awaiting type/entity/date
// assignment. Phase 1's only arrival path is quick capture; email-in,
// Todoist pull-ins, and the share target (Phase 2) land here through the
// same inbox flag. Rows open in the canvas for deep triage; the inline
// controls cover the fast cases (retype, mark triaged, trash).
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import RowAction from "@/components/home/RowAction";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import TriageControls from "@/components/inbox/TriageControls";
import QuickCapture from "@/components/today/QuickCapture";
import { listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { compareTypeKeys } from "@/lib/type-order";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export default async function Inbox() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const [typeRows, inboxItems] = await Promise.all([
    getDb().select({ key: types.key, label: types.label }).from(types),
    // Active-only: a completed/archived item is no longer awaiting triage, and
    // completion clears the inbox flag (see updateItem). This also keeps done
    // items from ever showing here while the import-flag backlog is cleaned up.
    listItems(owner.id, { inbox: true, statusCategory: "active", limit: 200 }),
  ]);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));
  // Oldest first: the Inbox is a queue, and the back of it is the debt.
  inboxItems.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Inbox
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {inboxItems.length === 0
            ? "Nothing waiting."
            : `${inboxItems.length} item${
                inboxItems.length === 1 ? "" : "s"
              } awaiting triage`}
        </p>

        <div className="mt-6">
          <QuickCapture />
        </div>

        {inboxItems.length > 0 && (
          <SelectionProvider ids={inboxItems.map((item) => item.id)}>
          <ul className="mt-6">
            {inboxItems.map((item) => (
              <li
                key={item.id}
                className="group flex flex-col gap-1 rounded px-2 py-1 hover:bg-neutral-800/60 sm:flex-row sm:items-center sm:gap-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                <SelectCheckbox id={item.id} />
                <Link
                  href={`/items/${item.id}`}
                  className={`min-w-0 flex-1 truncate text-sm ${
                    item.title ? "text-neutral-200" : "text-neutral-500"
                  }`}
                >
                  {item.title || "Untitled"}
                </Link>
                </div>
                {/* On phones the date + triage controls wrap to their own row
                    under the title (the dense one-line row crushed the title);
                    on sm+ they rejoin the title's row via display:contents. */}
                <div className="flex items-center gap-2 sm:contents">
                  <span className="shrink-0 text-xs text-neutral-600">
                    {dateFmt.format(item.createdAt)}
                  </span>
                  <TriageControls
                    id={item.id}
                    type={item.type}
                    typeOptions={typeRows}
                  />
                  <RowAction id={item.id} action="trash" />
                </div>
              </li>
            ))}
          </ul>
          <BulkActionBar />
          </SelectionProvider>
        )}
      </div>
    </main>
  );
}
