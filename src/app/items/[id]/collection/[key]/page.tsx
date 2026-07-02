// The collection drill-down page (Tyler, 2026-07-01): a record's widget card
// (Tasks / Docs / Meetings / Milestones / Links / Related Records) shows only a
// capped preview; clicking "Showing N of M →" lands here, which lists EVERY item
// of that collection associated with the record as a clickable list. This keeps
// the record homepage glanceable while nothing is buried. The query is exactly
// the one the card previews (record-widgets.ts boundFilter), just uncapped, so
// the two never diverge. Multi-select + bulk actions per the standard (ADR-118).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import RowAction from "@/components/home/RowAction";
import { bulkConfigForType } from "@/lib/bulk-config";
import { getItem } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getType } from "@/lib/types";
import { boundFilter, sortTasksDoneLast } from "@/lib/record-widgets";
import { widgetById } from "@/lib/widgets";
import { countViewItems, queryViewItems, VIEW_MAX, type ViewSort } from "@/lib/views";

export const dynamic = "force-dynamic";

// The Notes collection reads as "Docs" on a record (matches the card title).
const COLLECTION_TITLE: Record<string, string> = { notes: "Docs" };

const CATEGORY_DOT: Record<string, string> = {
  not_started: "bg-neutral-500",
  in_progress: "bg-amber-500",
  done: "bg-green-500",
  archived: "bg-neutral-700",
};

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}): Promise<Metadata> {
  const { id, key } = await params;
  try {
    const owner = await resolveOwner();
    if (!owner) return {};
    const [record, def] = [await getItem(owner.id, id), widgetById(key)];
    const collection = def ? COLLECTION_TITLE[def.id] ?? def.label : "Items";
    return { title: `${collection} · ${record.title || "Untitled"}` };
  } catch {
    return {};
  }
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  const { id, key } = await params;
  const owner = await resolveOwner();
  if (!owner) notFound();

  const def = widgetById(key);
  // Only collection/related widgets have a drill-down; property/derived don't.
  const collectionType = def?.recordQuery?.collectionType ?? null;
  const isRelated = def?.id === "relatedRecords";
  if (!def || (!collectionType && !isRelated)) notFound();

  let record;
  try {
    record = await getItem(owner.id, id);
  } catch {
    notFound();
  }

  const filter = boundFilter(def, id);
  if (!filter) notFound();

  const sort: ViewSort =
    collectionType === "event"
      ? { field: "meetingAt", dir: "asc" }
      : collectionType === "milestone"
        ? { field: "dueDate", dir: "asc" }
        : { field: "updatedAt", dir: "desc" };

  const [rowsRaw, total] = await Promise.all([
    queryViewItems(owner.id, filter, sort, VIEW_MAX),
    countViewItems(owner.id, filter),
  ]);
  // Tasks: done always sinks to the bottom (same rule as the card preview).
  const rows = collectionType === "task" ? sortTasksDoneLast(rowsRaw) : rowsRaw;

  const label = COLLECTION_TITLE[def.id] ?? def.label;
  // Typed collection → that type's bulk actions; mixed Related Records → the
  // generic Move + Delete only (bulkConfigForType(null)).
  const typeDef = collectionType ? await getType(collectionType).catch(() => null) : null;
  const bulkConfig = typeDef ? bulkConfigForType(typeDef) : {};

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-2 pb-24 pt-4 sm:px-8 md:px-12">
        <nav className="mb-1 text-xs text-neutral-500">
          <Link href={`/items/${id}`} className="hover:text-neutral-300">
            {record.title || "Untitled"}
          </Link>
          <span className="px-1.5 text-neutral-700">/</span>
          <span className="text-neutral-400">{label}</span>
        </nav>
        <h1 className="mb-4 text-lg font-medium text-neutral-100">
          {label}
          <span className="ml-2 text-sm font-normal text-neutral-500">{total}</span>
        </h1>

        {rows.length === 0 ? (
          <p className="mt-6 px-2 text-sm text-neutral-600">Nothing here yet.</p>
        ) : (
          <SelectionProvider ids={rows.map((r) => r.id)}>
            <SelectModeToggle />
            <ul className="mt-2 flex flex-col">
              {rows.map((r) => {
                const done = r.statusCategory === "done";
                const day = r.scheduledDate ?? r.dueDate ?? r.meetingAt;
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 border-b border-neutral-900 py-2 last:border-0"
                  >
                    <SelectCheckbox id={r.id} />
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT[r.statusCategory] ?? "bg-neutral-600"}`} />
                    <Link
                      href={`/items/${r.id}`}
                      className={`min-w-0 flex-1 truncate text-sm hover:text-neutral-100 ${done ? "text-neutral-500 line-through" : "text-neutral-200"}`}
                    >
                      {r.title || "Untitled"}
                    </Link>
                    {day && <span className="shrink-0 text-xs text-neutral-500">{dateFmt.format(day)}</span>}
                    <RowAction id={r.id} action="trash" />
                  </li>
                );
              })}
            </ul>
            {rows.length < total && (
              <p className="mt-4 px-2 text-xs text-neutral-600">
                Showing the first {rows.length} of {total}.
              </p>
            )}
            <BulkActionBar {...bulkConfig} />
          </SelectionProvider>
        )}
      </div>
    </main>
  );
}
