// Generic focused list for one type (slice 33 follow-up, ADR-044): the
// destination for a custom type's tab in ListTabs. The five system types have
// their own bespoke pages (/tasks etc.); every other type renders here — a
// plain list of its live items with create/open/trash, framed by the same tab
// strip. notFound() for an unknown type key.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import FilterBar, { type FilterSelect } from "@/components/lists/FilterBar";
import ListPage from "@/components/lists/ListPage";
import NewItemButton from "@/components/home/NewItemButton";
import RowAction from "@/components/home/RowAction";
import { ItemError } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";
import { getType } from "@/lib/types";
import {
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

  // The type's select/multi_select properties become list filters (the
  // filter counterpart to board grouping). queryViewItems with just {type}
  // matches the old listItems read; a property filter narrows it.
  const sp = await searchParams;
  const filterProps = propertyFilterOptions(typeDef.propertySchema);
  const propFilters = propertyFiltersFromParams(sp, typeDef.propertySchema);
  const items = await queryViewItems(owner.id, {
    type,
    ...(propFilters.length ? { propertyFilters: propFilters } : {}),
  });

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
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"}`}
      actions={<NewItemButton type={type} />}
    >
      {selects.length > 0 && (
        <div className="mt-4">
          <FilterBar selects={selects} />
        </div>
      )}
      {items.length > 0 ? (
        <ul className="mt-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60"
            >
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
      ) : (
        <p className="mt-6 px-2 text-sm text-neutral-600">
          {propFilters.length
            ? "No items match these filters."
            : `No ${typeDef.label.toLowerCase()} items yet.`}
        </p>
      )}
    </ListPage>
  );
}
