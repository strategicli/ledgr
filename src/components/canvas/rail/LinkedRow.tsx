// The task rail's "Linked" row (ADR-252). "+ Relate" used to float unlabelled
// under the body, and when a task had no links yet it was a bare button with no
// home — the orphan Tyler flagged on 2026-09-11. It moves here instead, beside
// Project / Tags / People, which are relation edges too: the rail is everything
// ABOUT the task, the main pane is the work.
//
// The row is deliberately a label + count + "+", NOT a chip list: the Linked here
// panel below already lists the items, and repeating them in a 248px rail would
// say the same thing twice. Clicking the count jumps to that panel.
import { listRelatedItems } from "@/lib/relations";
import { RAIL_LABEL } from "./styles";
import AddRelation from "@/components/relations/AddRelation";

export default async function LinkedRow({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
}) {
  // Same source as the panel below, so the count can never disagree with it.
  const related = await listRelatedItems(ownerId, itemId);
  const count = related.length;

  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className={RAIL_LABEL}>Linked</span>
        <AddRelation itemId={itemId} rail />
      </div>
      <span className="text-sm text-ink-muted">
        {count === 0 ? (
          <span className="text-ink-faint">Nothing linked</span>
        ) : (
          `${count} item${count === 1 ? "" : "s"}`
        )}
      </span>
    </div>
  );
}
