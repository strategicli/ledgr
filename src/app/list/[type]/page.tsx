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
import CalendarFeed from "@/components/calendar/CalendarFeed";
import EventTimeline from "@/components/events/EventTimeline";
import { listCalendarFeed, type FeedEvent } from "@/lib/calendar/feed";
import NewItemButton from "@/components/home/NewItemButton";
import ProjectCardGrid from "@/components/projects/ProjectCardGrid";
import RowAction from "@/components/home/RowAction";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectCheckbox from "@/components/selection/SelectCheckbox";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import SubtaskExpandableRow from "@/components/subtasks/SubtaskExpandableRow";
import { childRollups } from "@/lib/subtasks";
import { bulkConfigForType } from "@/lib/bulk-config";
import { ItemError } from "@/lib/items";
import { lensesForType, resolveLensSort, selectLens } from "@/lib/list-lenses";
import { relatedSummaryFor } from "@/lib/relations";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { getType } from "@/lib/types";
import { listProjectCardData } from "@/lib/project-cards";
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
  const now = new Date();
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
  // grows it). The count is the true match total (filters included). Bespoke
  // lenses (calendar/timeline) ignore the sort and render their own body.
  const filterProps = propertyFilterOptions(typeDef.propertySchema);
  const propFilters = propertyFiltersFromParams(sp, typeDef.propertySchema);
  const filter = { type, ...(propFilters.length ? { propertyFilters: propFilters } : {}) };
  const show = parseListWindow(sp.show);
  let items: Awaited<ReturnType<typeof queryViewItems>> = [];
  let count: number;
  let feed: FeedEvent[] | null = null;
  // Timeline: one meeting-time-ordered fetch, split into upcoming/past/undated.
  let timeline: {
    rows: Awaited<ReturnType<typeof queryViewItems>>;
    upcoming: Awaited<ReturnType<typeof queryViewItems>>;
    past: Awaited<ReturnType<typeof queryViewItems>>;
    undated: Awaited<ReturnType<typeof queryViewItems>>;
  } | null = null;
  if (viewData) {
    count = viewData.count;
  } else if (active.kind === "calendar") {
    [feed, count] = await Promise.all([
      listCalendarFeed(owner.id, { now }),
      countViewItems(owner.id, filter),
    ]);
  } else if (active.kind === "timeline") {
    let rows: Awaited<ReturnType<typeof queryViewItems>>;
    [rows, count] = await Promise.all([
      queryViewItems(owner.id, filter, { field: "meetingAt", dir: "desc" }, show),
      countViewItems(owner.id, filter),
    ]);
    timeline = {
      rows,
      upcoming: rows.filter((m) => m.meetingAt != null && m.meetingAt >= now).reverse(),
      past: rows.filter((m) => m.meetingAt != null && m.meetingAt < now),
      undated: rows.filter((m) => m.meetingAt == null),
    };
  } else {
    [items, count] = await Promise.all([
      queryViewItems(owner.id, filter, resolveLensSort(active, reversed) ?? undefined, show),
      countViewItems(owner.id, filter),
    ]);
  }

  // The Projects list renders as a card grid (Tyler, 2026-07-01) on the default
  // sort path; a saved view lens still renders via ViewRenderer.
  const projectCards =
    type === "project" && !viewData && items.length > 0
      ? await listProjectCardData(owner.id, items)
      : [];

  // Subtask "n/m" rollups + a linked-item summary for the in-view rows (empty
  // for the non-list lenses, which leave `items` empty). Two extra owner-scoped,
  // body-free queries. The linked summary powers the richer row (ui-refresh S2):
  // now that the list uses the full width, each row shows who it's linked to and
  // when it was touched instead of a lone title on a mostly-empty line. Skipped
  // for the Projects card grid (it renders its own richer cards).
  const rowIds = type === "project" ? [] : items.map((i) => i.id);
  const [rollups, linked] = await Promise.all([
    childRollups(owner.id, items.map((i) => i.id)),
    rowIds.length
      ? relatedSummaryFor(owner.id, rowIds)
      : Promise.resolve(new Map<string, { id: string; title: string; type: string }[]>()),
  ]);
  const listRowClass = "group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2";

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
      width="list"
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
        <ViewLensBody data={viewData} bulkConfig={bulkConfigForType(typeDef)} ownerId={owner.id} />
      ) : active.kind === "calendar" ? (
        <CalendarFeed events={feed ?? []} now={now} />
      ) : timeline ? (
        <SelectionProvider
          ids={[...timeline.upcoming, ...timeline.past, ...timeline.undated].map((m) => m.id)}
        >
          <SelectModeToggle />
          <EventTimeline
            upcoming={timeline.upcoming}
            past={timeline.past}
            undated={timeline.undated}
            now={now}
          />
          <LoadMore
            shown={timeline.rows.length}
            total={count}
            basePath={`/list/${type}`}
            params={sp}
          />
          <BulkActionBar {...bulkConfigForType(typeDef)} />
        </SelectionProvider>
      ) : (
        <>
          {selects.length > 0 && (
            <div className="mt-4">
              <FilterBar selects={selects} />
            </div>
          )}
          {items.length > 0 && type === "project" ? (
            <>
              <ProjectCardGrid cards={projectCards} />
              <LoadMore shown={items.length} total={count} basePath={`/list/${type}`} params={sp} />
            </>
          ) : items.length > 0 ? (
            <SelectionProvider ids={items.map((item) => item.id)}>
              <SelectModeToggle />
              <ul className="mt-4">
                {items.map((item) => {
                  const rollup = rollups.get(item.id);
                  const rel = linked.get(item.id) ?? [];
                  const extra = rel.length > 1 ? rel.length - 1 : 0;
                  const inner = (
                    <>
                      <SelectCheckbox id={item.id} />
                      <Link
                        href={`/items/${item.id}`}
                        className={`ui-row min-w-0 flex-1 truncate ${
                          item.title ? "text-ink" : "text-ink-subtle"
                        }`}
                      >
                        {item.title || "Untitled"}
                      </Link>
                      {rel[0] && (
                        <Link
                          href={`/items/${rel[0].id}`}
                          className="hidden shrink-0 max-w-[28%] truncate rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted hover:text-ink sm:inline"
                          title={`Linked to ${rel[0].title || "Untitled"}${extra ? ` +${extra} more` : ""}`}
                        >
                          {rel[0].title || "Untitled"}
                          {extra ? ` +${extra}` : ""}
                        </Link>
                      )}
                      <span className="ui-meta shrink-0 tabular-nums">
                        {dateFmt.format(new Date(item.updatedAt))}
                      </span>
                      <RowAction id={item.id} action="trash" />
                    </>
                  );
                  return rollup && rollup.total > 0 ? (
                    <SubtaskExpandableRow
                      key={item.id}
                      id={item.id}
                      done={rollup.done}
                      total={rollup.total}
                      liClassName={listRowClass}
                    >
                      {inner}
                    </SubtaskExpandableRow>
                  ) : (
                    <li key={item.id} className={listRowClass}>
                      {inner}
                    </li>
                  );
                })}
              </ul>
              <LoadMore shown={items.length} total={count} basePath={`/list/${type}`} params={sp} />
              <BulkActionBar {...bulkConfigForType(typeDef)} />
            </SelectionProvider>
          ) : (
            <p className="ui-row mt-6 px-2 text-ink-subtle">
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
