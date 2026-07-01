// The project header's Status control (Tyler, 2026-07-01): a compact pill that
// reads "Status: Ongoing" (no separate label), pinned top-right on the project
// canvas, opening a swatch menu of the type's statuses. Same optimistic PATCH +
// refresh as the rail's StatusRow, styled as a chip instead of a row.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginSave, endSave } from "@/lib/save-status";
import type { StatusDef } from "@/lib/status";
import Popover from "@/components/ui/Popover";

export default function ProjectStatusChip({
  itemId,
  statuses,
  initial,
}: {
  itemId: string;
  statuses: StatusDef[];
  initial: string;
}) {
  const router = useRouter();
  const [val, setVal] = useState(initial);
  const [prev, setPrev] = useState(initial);
  if (initial !== prev) {
    setPrev(initial);
    setVal(initial);
  }

  async function pick(key: string, close: () => void) {
    const before = val;
    setVal(key);
    close();
    beginSave();
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: key }),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
    } catch {
      setVal(before);
      endSave(false);
    }
  }

  const cur = statuses.find((s) => s.key === val);
  return (
    <Popover
      ariaLabel="Status"
      align="right"
      width={208}
      triggerClassName="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-2.5 py-1 text-sm text-neutral-300 hover:border-neutral-600"
      trigger={
        <>
          <span
            aria-hidden
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: cur?.color ?? "#64748b" }}
          />
          <span className="text-neutral-500">Status:</span>
          <span className="text-neutral-200">{cur?.label ?? val}</span>
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          {statuses.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => pick(s.key, close)}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                s.key === val ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              {s.category === "done" ? " ✓" : ""}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
