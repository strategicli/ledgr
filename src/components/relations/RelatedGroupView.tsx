// One related-type group on an item's detail page, structured by the owner's
// chosen lens and rendered through the standard ViewRenderer (the same renderer
// the list pages and dashboards use). The header carries the type label, the
// group's count, and the in-place lens picker; the body is the ViewRenderer in
// the lens's layout, with each row's relation controls passed through the
// rowActions slot. Server component — the picker and the row controls are the
// only client islands.
import type { ReactNode } from "react";
import InlineLabel from "@/components/build/InlineLabel";
import ViewLensBody from "@/components/lists/ViewLensBody";
import type { BulkActionConfig } from "@/lib/bulk-config";
import type { Lens } from "@/lib/list-lenses";
import type { ViewLensData } from "@/lib/view-render";
import RelatedLensPicker from "./RelatedLensPicker";

export default function RelatedGroupView({
  hostType,
  typeKey,
  label,
  lenses,
  currentLensId,
  data,
  rowActions,
  bulkConfig,
}: {
  hostType: string;
  typeKey: string;
  label: string;
  lenses: Lens[];
  currentLensId: string;
  data: ViewLensData;
  rowActions?: Record<string, ReactNode>;
  // When set, the group's rows carry the multi-select layer (checkboxes + the
  // floating BulkActionBar, ADR-118). A related group is always one type, so the
  // caller passes that type's full bulkConfigForType — richer than a mixed
  // surface's Move+Delete. Omit to render the group read-only (as before).
  bulkConfig?: BulkActionConfig;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="flex items-center justify-between gap-2 px-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <InlineLabel typeKey={typeKey} label={label} />
          <span className="ml-2 font-normal text-neutral-600">{data.count}</span>
        </h3>
        {/* The default strip is four lenses, so there's always something to pick;
            still guard the rare single-lens type. */}
        {lenses.length > 1 && (
          <RelatedLensPicker
            hostType={hostType}
            relatedType={typeKey}
            lenses={lenses}
            currentId={currentLensId}
          />
        )}
      </div>
      <ViewLensBody data={data} bulkConfig={bulkConfig} rowActions={rowActions} />
    </div>
  );
}
