// Minimal Work-surface home: items grouped by type, with create, open,
// trash, and restore. An interim page so manual testing has a front door;
// the Today view, per-type lists, and navigation shell slices replace it.
import Link from "next/link";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { listItems } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

// Seed order for the system types; anything added later sorts after them.
const TYPE_ORDER = ["task", "meeting", "note", "link", "entity"];

type ListedItem = Awaited<ReturnType<typeof listItems>>[number];

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function ItemRow({
  item,
  action,
}: {
  item: ListedItem;
  action: "trash" | "restore";
}) {
  return (
    <li className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50">
      <Link
        href={`/items/${item.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
          item.title ? "text-gray-800" : "text-gray-400"
        } ${action === "restore" ? "pointer-events-none" : ""}`}
      >
        {item.title || "Untitled"}
      </Link>
      {item.status !== "open" && (
        <span className="shrink-0 rounded bg-gray-100 px-1.5 text-xs text-gray-500">
          {item.status}
        </span>
      )}
      <span className="shrink-0 text-xs text-gray-300">
        {dateFmt.format(new Date(item.updatedAt))}
      </span>
      <RowAction id={item.id} action={action} />
    </li>
  );
}

export default async function Home() {
  const owner = await resolveOwner();
  if (!owner) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Ledgr</h1>
        <p className="text-sm text-neutral-500">
          Phase 1 scaffold. The Work surface starts here.
        </p>
      </main>
    );
  }

  const [typeRows, live, trashed] = await Promise.all([
    getDb().select({ key: types.key, label: types.label }).from(types),
    listItems(owner.id, { limit: 200 }),
    listItems(owner.id, { trash: true, limit: 50 }),
  ]);

  typeRows.sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.key);
    const bi = TYPE_ORDER.indexOf(b.key);
    if (ai === -1 && bi === -1) return a.key.localeCompare(b.key);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const byType = new Map<string, ListedItem[]>();
  for (const item of live) {
    const group = byType.get(item.type);
    if (group) group.push(item);
    else byType.set(item.type, [item]);
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
      <h1 className="text-2xl font-bold tracking-tight">Ledgr</h1>
      <p className="mt-1 text-sm text-gray-400">
        {live.length} item{live.length === 1 ? "" : "s"} · signed in as{" "}
        {owner.email}
      </p>

      {typeRows.map(({ key, label }) => {
        const group = byType.get(key) ?? [];
        return (
          <section key={key} className="mt-8">
            <div className="flex items-baseline justify-between border-b border-gray-100 pb-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {label}
                {group.length > 0 && (
                  <span className="ml-2 font-normal text-gray-300">
                    {group.length}
                  </span>
                )}
              </h2>
              <NewItemButton type={key} />
            </div>
            {group.length > 0 ? (
              <ul className="mt-1">
                {group.map((item) => (
                  <ItemRow key={item.id} item={item} action="trash" />
                ))}
              </ul>
            ) : (
              <p className="mt-2 px-2 text-sm text-gray-300">No items yet.</p>
            )}
          </section>
        );
      })}

      <details className="mt-10">
        <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-600">
          Trash ({trashed.length})
        </summary>
        {trashed.length > 0 ? (
          <ul className="mt-1">
            {trashed.map((item) => (
              <ItemRow key={item.id} item={item} action="restore" />
            ))}
          </ul>
        ) : (
          <p className="mt-2 px-2 text-sm text-gray-300">Trash is empty.</p>
        )}
      </details>
      </div>
    </main>
  );
}
