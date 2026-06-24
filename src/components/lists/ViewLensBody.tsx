// Body for an active VIEW lens: the referenced saved view rendered with the
// standard ViewRenderer (list/table/board/calendar/agenda) — the same renderer
// dashboards use for a "view widget". The view + items are resolved upstream by
// resolveViewLens (scoped to the type), so this is a thin presentational shell.
import ViewRenderer from "@/components/views/ViewRenderer";
import type { ViewLensData } from "@/lib/view-render";

export default function ViewLensBody({ data }: { data: ViewLensData }) {
  return (
    <div className="mt-4">
      <ViewRenderer
        view={data.view}
        items={data.items}
        groupOrder={data.groupOrder}
        propertyLabels={data.propertyLabels}
      />
    </div>
  );
}
