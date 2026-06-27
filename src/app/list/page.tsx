// The Types directory: a Work-side "30k-ft" index of every type the owner has,
// each with its live item count, linking into that type's lens list at
// /list/[type]. New types appear here automatically (it reads listTypes), so it
// stays current without any nav wiring. This is the *using* counterpart to Build
// → Model Overview (/build), which lists the same types but mixes in views,
// stats, and hygiene for *building/maintaining* the model — the Work/Build split.
// Registered as a Built-in nav destination (nav-slot-options.ts) so it can be
// pinned to the Work bar as a menu item.
import Link from "next/link";
import { redirect } from "next/navigation";
import ListPage from "@/components/lists/ListPage";
import NavGlyph from "@/components/nav/NavGlyph";
import { itemCountsByType } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { listTypes } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function TypesDirectory() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  // listTypes() excludes hidden types by default and carries the model's own
  // ordering, so this directory reads the same as Build → Model Overview.
  const [types, counts] = await Promise.all([listTypes(), itemCountsByType(owner.id)]);

  return (
    <ListPage title="Types" subtitle={`${types.length} type${types.length === 1 ? "" : "s"}`}>
      <ul className="flex flex-col gap-1">
        {types.map((t) => {
          const n = counts[t.key] ?? 0;
          return (
            <li key={t.key}>
              <Link
                href={`/list/${t.key}`}
                className="flex items-center gap-3 rounded px-2 py-2 hover:bg-neutral-800/60"
              >
                <NavGlyph
                  icon={t.icon ?? "items"}
                  size={18}
                  className="shrink-0 text-neutral-500"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                  {t.label}
                </span>
                {!t.isSystem && (
                  <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
                    custom
                  </span>
                )}
                <span
                  className={`shrink-0 text-sm tabular-nums ${
                    n === 0 ? "text-neutral-600" : "text-neutral-400"
                  }`}
                >
                  {n}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ListPage>
  );
}
