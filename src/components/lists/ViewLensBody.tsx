// Body for an active VIEW lens: the referenced saved view rendered with the
// standard ViewRenderer (list/table/board/calendar/agenda) — the same renderer
// dashboards use for a "view widget". The view + items are resolved upstream by
// resolveViewLens (scoped to the type), so this is a thin presentational shell.
//
// When `bulkConfig` is passed (a type list handing down its bulk config), the
// rendered rows carry selection checkboxes and the floating BulkActionBar
// (ADR-118). The list/table/agenda layouts honor it; board/calendar render no
// checkboxes, so the bar simply never appears there.
import BulkActionBar from "@/components/selection/BulkActionBar";
import SelectionProvider from "@/components/selection/SelectionProvider";
import SelectModeToggle from "@/components/selection/SelectModeToggle";
import ViewRenderer from "@/components/views/ViewRenderer";
import type { BulkActionConfig } from "@/lib/bulk-config";
import type { ViewLensData } from "@/lib/view-render";

export default function ViewLensBody({
  data,
  bulkConfig,
}: {
  data: ViewLensData;
  bulkConfig?: BulkActionConfig;
}) {
  const renderer = (
    <ViewRenderer
      view={data.view}
      items={data.items}
      groupOrder={data.groupOrder}
      propertyLabels={data.propertyLabels}
      selectable={bulkConfig != null}
    />
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
