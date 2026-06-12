// Done-toggle for a subtask row. Optimistic (rule 8): the box flips
// immediately, the PATCH lands behind it, and a failure flips it back; the
// refresh re-renders strike-through and rollups from the server.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SubtaskCheckbox({
  id,
  done,
}: {
  id: string;
  done: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(done);
  useEffect(() => setChecked(done), [done]);

  async function toggle() {
    const next = !checked;
    setChecked(next);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next ? "done" : "open" }),
      });
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
      className="size-4 shrink-0 cursor-pointer accent-blue-600"
      aria-label={checked ? "Mark not done" : "Mark done"}
    />
  );
}
