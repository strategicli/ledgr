// Done-toggle for a subtask row. Optimistic (rule 8): the box flips
// immediately, the PATCH lands behind it, and a failure flips it back; a
// coalesced refresh re-renders strike-through and rollups from the server. The
// refresh is debounced (list-refresh) so triaging many tasks in a burst queues
// one refetch on idle, not one per click.
"use client";

import { useState } from "react";
import { useListRefresh } from "@/lib/list-refresh";

export default function SubtaskCheckbox({
  id,
  done,
}: {
  id: string;
  done: boolean;
}) {
  const refresh = useListRefresh();
  const [checked, setChecked] = useState(done);
  // Re-adopt the server value when a refresh changes it (adjust-during-
  // render pattern; an effect here would double-render).
  const [prevDone, setPrevDone] = useState(done);
  if (done !== prevDone) {
    setPrevDone(done);
    setChecked(done);
  }

  async function toggle() {
    const next = !checked;
    setChecked(next);
    try {
      // The complete endpoint toggles to the item type's default done /
      // not-started status (S2), so the checkbox needs no status schema.
      const res = await fetch(`/api/items/${id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      refresh();
    } catch {
      setChecked(!next);
    }
  }

  // A padded label wraps the 16px control so touch gets a ~40px tap target
  // (clearing the ~44px minimum with the row's own padding) without abutting the
  // tap-to-open title; the enlargement is scoped to coarse pointers, so desktop
  // density is unchanged (globals.css `.ledgr-check-hit`). Swipe-right stays the
  // primary mobile complete gesture (SwipeRow).
  return (
    <label className="ledgr-check-hit">
      <input
        type="checkbox"
        checked={checked}
        onChange={toggle}
        className="ledgr-check"
        aria-label={checked ? "Mark not done" : "Mark done"}
      />
    </label>
  );
}
