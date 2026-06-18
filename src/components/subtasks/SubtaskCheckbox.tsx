// Done-toggle for a subtask row. Optimistic (rule 8): the box flips
// immediately, the PATCH lands behind it, and a failure flips it back; the
// refresh re-renders strike-through and rollups from the server.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SubtaskCheckbox({
  id,
  done,
}: {
  id: string;
  done: boolean;
}) {
  const router = useRouter();
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
      router.refresh();
    } catch {
      setChecked(!next);
    }
  }

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={toggle}
      className="ledgr-check"
      aria-label={checked ? "Mark not done" : "Mark done"}
    />
  );
}
