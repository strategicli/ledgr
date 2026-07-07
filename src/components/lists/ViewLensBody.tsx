// Body for an active VIEW lens: the referenced saved view rendered with the
// standard ViewRenderer (list/table/board/calendar/agenda) — the same renderer
// dashboards use for a "view widget". The view + items are resolved upstream by
// resolveViewLens (scoped to the type), so this is a thin presentational shell.
//
// When `bulkConfig` is passed (a type list handing down its bulk config), the
// rendered rows carry selection checkboxes and the floating BulkActionBar
// (ADR-118). The list/table/agenda layouts honor it; board/calendar render no
// checkboxes, so the bar simply never appears there.
//
// `rowActions` is the per-row trailing slot (keyed by item id) — the related
// panel passes its relation controls (un-relate, @-mention marker) here so the
// "Linked here" and meeting "Open tasks" groups reuse this same body, getting
// the multi-select layer for free without a parallel wrapper (ADR-118 + #129).
import type { ReactNode } from "react";
import { DeskHostProvider } from "@/components/desk/DeskHostContext";
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import ViewRenderer from "@/components/views/ViewRenderer";
import type { BulkActionConfig } from "@/lib/bulk-config";
import { appTodayYmd } from "@/lib/recurrence-service";
import { DEFAULT_TIMEZONE, getAppTimezone } from "@/lib/today";
import { childRollups } from "@/lib/subtasks";
import type { ViewLensData } from "@/lib/view-render";

export default async function ViewLensBody({
  data,
  bulkConfig,
  rowActions,
  ownerId,
}: {
  data: ViewLensData;
  bulkConfig?: BulkActionConfig;
  rowActions?: Record<string, ReactNode>;
  // When set, the list/agenda rows get subtask "n/m" indicators. The type list
  // passes it; callers without an owner in scope omit it and rows stay plain.
  ownerId?: string;
}) {
  const rollups = ownerId
    ? await childRollups(ownerId, data.items.map((i) => i.id))
    : undefined;
  const tz = ownerId ? await getAppTimezone(ownerId) : DEFAULT_TIMEZONE;
  // Make rows interactive (swipe + row menu, ADR-142) on a real type-list lens,
  // but not when the related panel is driving this body (it passes rowActions —
  // its own relation controls are the row's interaction there; defer by hiding).
  const today = rowActions ? undefined : appTodayYmd(new Date(), tz);
  // Anchor "Open beside" to this saved view — but only on an interactive lens
  // (`today` set). When the related panel drives this body (rowActions), the
  // rows carry no send menu, and the view isn't the reading context, so no host.
  const renderer = (
    <DeskHostProvider
      host={
        today ? { kind: "view", viewId: data.view.id, title: data.view.name } : null
      }
    >
      <ViewRenderer
        view={data.view}
        items={data.items}
        groupOrder={data.groupOrder}
        propertyLabels={data.propertyLabels}
        selectable={bulkConfig != null}
        rowActions={rowActions}
        rollups={rollups}
        today={today}
        tz={tz}
      />
    </DeskHostProvider>
  );

  if (!bulkConfig) {
    return <div className="mt-4">{renderer}</div>;
  }

  return (
    <SelectionProvider ids={data.items.map((item) => item.id)}>
      {/* Board/calendar render no row checkboxes (ADR-118), so no toggle. */}
      {data.view.layout !== "board" && data.view.layout !== "calendar" && (
        <SelectModeToggle />
      )}
      <div className="mt-4">{renderer}</div>
      <BulkActionBar {...bulkConfig} />
    </SelectionProvider>
  );
}
