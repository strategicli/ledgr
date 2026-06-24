// The rail's "Status" row for select-mode types (ADR-106/108): the status as a
// compact row that opens a swatch menu of the type's resolved statuses. The
// default task uses checkbox mode (rendered inline in TaskCanvas), so this only
// shows when a type opts into the select display. Optimistic PATCH + refresh.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginSave, endSave } from "@/lib/save-status";
import type { StatusDef } from "@/lib/status";
import Popover from "@/components/ui/Popover";
import { RowFace, MenuItem } from "./row-ui";
import { RAIL_TRIGGER } from "./styles";

export default function StatusRow({
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
      triggerClassName={RAIL_TRIGGER}
      trigger={
        <RowFace label="Status">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: cur?.color ?? "#64748b" }}
          />
          {cur?.label ?? val}
        </RowFace>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          {statuses.map((s) => (
            <MenuItem key={s.key} active={s.key === val} onClick={() => pick(s.key, close)}>
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
              {s.category === "done" ? " ✓" : ""}
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}
