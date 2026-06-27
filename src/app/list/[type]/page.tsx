// Generic focused list for one type (slice 33 follow-up, ADR-044): the
// destination for a custom type and for People. The five system types have
// their own bespoke pages (/tasks etc.); every other type renders here — a
// plain list of its live items with create/open/trash. notFound() for an
// unknown type key.
//
// Every type's list carries the customizable tab strip ("list lenses",
// ListLenses): four virtual sort defaults (Recent / Newest / A→Z / Most linked)
// plus any the owner added in Build, including saved-view ("widget") tabs. The
// active lens decides the body: a sort lens orders this plain list; a view lens
// renders its saved view via ViewRenderer (scoped to the type).
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import FilterBar, { type FilterSelect } from "@/components/lists/FilterBar";
import ListLenses from "@/components/lists/ListLenses";
import ListPage from "@/components/lists/ListPage";
import LoadMore from "@/components/lists/LoadMore";
import ViewLensBody from "@/components/lists/ViewLensBody";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import { bulkConfigForType } from "@/lib/bulk-config";
import { ItemError } from "@/lib/items";
import { lensesForType, resolveLensSort, selectLens } from "@/lib/list-lenses";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { getType } from "@/lib/types";
import { resolveViewLens } from "@/lib/view-render";
import {
  countViewItems,
  parseListWindow,
  PROPERTY_FILTER_NONE,
  propertyFilterOptions,
  propertyFiltersFromParams,
  queryViewItems,
} from "@/lib/views";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

export default async function TypeList({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { type } = await params;
  const typeDef = await getType(type).catch((err) => {
    if (err instanceof ItemError && err.code === "not_found") notFound();
    throw err;
  });

  const sp = await searchParams;
  const settings = await getSettings(owner.id);
  const lenses = lensesForType(settings, type);
  const active = selectLens(lenses, typeof sp.lens === "string" ? sp.lens : undefined);
  const reversed = sp.rev === "1";

  // A view lens renders its saved view; a missing/deleted view (null) falls back
  // to the default sorted list below.
  const viewData =
    active.kind === "view" ? await resolveViewLens(owner.id, active.viewId, type) : null;

  // Sort path: the type's select/multi_select properties become list filters,
  // and the active sort lens (reversible) orders a window of rows (Load-more
  // grows it). The count is the true match total (filters included).
  const filterProps = propertyFilterOptions(typeDef.propertySchema);
  const propFilters = propertyFiltersFromParams(sp, typeDef.propertySchema);
  const filter = { type, ...(propFilters.length ? { propertyFilters: propFilters } : {}) };
  const show = parseListWindow(sp.show);
  let items: Awaited<ReturnType<typeof queryViewItems>> = [];
  let count: number;
  if (viewData) {
    count = viewData.count;
  } else {
    [items, count] = await Promise.all([
      queryViewItems(owner.id, filter, resolveLensSort(active, reversed) ?? undefined, show),
      countViewItems(owner.id, filter),
    ]);
  }

  const selects: FilterSelect[] = filterProps.map((fp) => ({
    param: `prop_${fp.key}`,
    label: fp.label,
    options: [
      { value: "", label: "any" },
      ...fp.options.map((o) => ({ value: o, label: o })),
      { value: PROPERTY_FILTER_NONE, label: "not set" },
    ],
  }));

  return (
    <ListPage
      tab={type}
      title={typeDef.label}
      subtitle={`${count} item${count === 1 ? "" : "s"}`}
      actions={<NewItemButton type={type} />}
    >
      <ListLenses
        lenses={lenses}
        activeId={active.id}
        reversed={reversed}
        basePath={`/list/${type}`}
        params={sp}
        editHref={`/build/types/${type}/edit`}
      />
      {viewData ? (
        <ViewLensBody data={viewData} bulkConfig={bulkConfigForType(typeDef)} />
      ) : (
        <>
          {selects.length > 0 && (
            <div className="mt-4">
              <FilterBar selects={selects} />
            </div>
          )}
          {items.length > 0 ? (
            <SelectionProvider ids={items.map((item) => item.id)}>
              <SelectModeToggle />
              <ul className="mt-4">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60"
                  >
                    <SelectCheckbox id={item.id} />
                    <Link
                      href={`/items/${item.id}`}
                      className={`min-w-0 flex-1 truncate text-sm ${
                        item.title ? "text-neutral-200" : "text-neutral-500"
                      }`}
                    >
                      {item.title || "Untitled"}
                    </Link>
                    <span className="shrink-0 text-xs text-neutral-600">
                      {dateFmt.format(new Date(item.updatedAt))}
                    </span>
                    <RowAction id={item.id} action="trash" />
                  </li>
                ))}
              </ul>
              <LoadMore shown={items.length} total={count} basePath={`/list/${type}`} params={sp} />
              <BulkActionBar {...bulkConfigForType(typeDef)} />
            </SelectionProvider>
          ) : (
            <p className="mt-6 px-2 text-sm text-neutral-600">
              {propFilters.length
                ? "No items match these filters."
                : `No ${typeDef.label.toLowerCase()} items yet.`}
            </p>
          )}
        </>
      )}
    </ListPage>
  );
}
