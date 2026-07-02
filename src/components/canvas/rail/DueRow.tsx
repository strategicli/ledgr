// The rail's "Due" row (ADR-108): the deadline as a compact row that opens a
// small date popover (same DayField as Schedule). Optimistic PATCH of dueDate +
// refresh, reverting on failure — the FieldStrip pattern.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginSave, endSave } from "@/lib/save-status";
import Popover from "@/components/ui/Popover";
import DayField from "./DayField";
import { RowFace } from "./row-ui";
import { RAIL_TRIGGER } from "./styles";
import { formatDayLabel, isOverdueYmd } from "@/lib/format-date";

function ymdToIso(ymd: string): string {
  return `${ymd}T00:00:00.000Z`;
}

export default function DueRow({
  itemId,
  initial,
  today,
  done = false,
}: {
  itemId: string;
  initial: string | null; // ISO instant or null
  today: string;
  // A completed task isn't "overdue" however old its due date — suppress the cue.
  done?: boolean;
}) {
  const router = useRouter();
  const [iso, setIso] = useState(initial);
  const [prev, setPrev] = useState(initial);
  if (initial !== prev) {
    setPrev(initial);
    setIso(initial);
  }

  async function pick(ymd: string | null) {
    const before = iso;
    const next = ymd ? ymdToIso(ymd) : null;
    setIso(next);
    beginSave();
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueDate: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
    } catch {
      setIso(before);
      endSave(false);
    }
  }

  const label = formatDayLabel(iso);
  const overdue = !done && isOverdueYmd(iso, today);
  return (
    <Popover
      ariaLabel="Due date"
      align="right"
      width={288}
      triggerClassName={RAIL_TRIGGER}
      trigger={
        <RowFace label="Due" empty={!iso} overdue={overdue}>
          {label ?? "Add date"}
        </RowFace>
      }
    >
      <DayField
        valueYmd={iso ? iso.slice(0, 10) : null}
        today={today}
        onPick={pick}
      />
    </Popover>
  );
}
