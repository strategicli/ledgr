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
import { compareTypeKeys } from "@/lib/type-order";

export const dynamic = "force-dynamic";

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
    <li className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60">
      <Link
        href={`/items/${item.id}`}
        className={`min-w-0 flex-1 truncate text-sm ${
          item.title ? "text-neutral-200" : "text-neutral-500"
        } ${action === "restore" ? "pointer-events-none" : ""}`}
      >
        {item.title || "Untitled"}
      </Link>
      {item.status !== "open" && (
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
          {item.status}
        </span>
      )}
      <span className="shrink-0 text-xs text-neutral-600">
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

  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));
  const byType = new Map<string, ListedItem[]>();
  for (const item of live) {
    const group = byType.get(item.type);
    if (group) group.push(item);
    else byType.set(item.type, [item]);
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
        Ledgr
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {live.length} item{live.length === 1 ? "" : "s"} · signed in as{" "}
        {owner.email}
      </p>

      {typeRows.map(({ key, label }) => {
        const group = byType.get(key) ?? [];
        return (
          <section key={key} className="mt-8">
            <div className="flex items-baseline justify-between border-b border-neutral-800 pb-1">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
                {label}
                {group.length > 0 && (
                  <span className="ml-2 font-normal text-neutral-600">
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
              <p className="mt-2 px-2 text-sm text-neutral-600">
                No items yet.
              </p>
            )}
          </section>
        );
      })}

      <details className="mt-10">
        <summary className="cursor-pointer text-sm text-neutral-500 hover:text-neutral-300">
          Trash ({trashed.length})
        </summary>
        {trashed.length > 0 ? (
          <ul className="mt-1">
            {trashed.map((item) => (
              <ItemRow key={item.id} item={item} action="restore" />
            ))}
          </ul>
        ) : (
          <p className="mt-2 px-2 text-sm text-neutral-600">Trash is empty.</p>
        )}
      </details>
      </div>
    </main>
  );
}
