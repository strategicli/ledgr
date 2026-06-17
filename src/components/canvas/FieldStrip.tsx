// The canvas top strip (PRD §4.13): the type's at-a-glance fields laid out
// horizontally as label-value pairs, one line instead of a Notion-style
// vertical stack. Every change PATCHes immediately and optimistically; a
// failure reverts to the server truth and says so.
"use client";

import { useState } from "react";
import type { CanvasField } from "@/lib/canvas-fields";
import { ITEM_STATUSES, URGENCIES } from "@/lib/item-enums";
import { beginSave, endSave } from "@/lib/save-status";

export type StripValues = {
  status: string;
  dueDate: string | null; // ISO strings; Dates don't round-trip user edits
  urgency: string | null;
  meetingAt: string | null;
  url: string | null;
};

// datetime-local wants local wall-clock time, no zone suffix.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";
const inputClass = `${selectClass} [color-scheme:dark]`;

export default function FieldStrip({
  itemId,
  fields,
  initial,
}: {
  itemId: string;
  fields: CanvasField[];
  initial: StripValues;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState(false);

  // One field per request is fine here: strip edits are single deliberate
  // clicks, not keystroke streams like the body autosave.
  async function save(patch: Partial<StripValues>) {
    const before = values;
    setValues((v) => ({ ...v, ...patch }));
    setError(false);
    beginSave();
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
    } catch {
      setValues(before);
      setError(true);
      endSave(false);
    }
  }

  function field(name: CanvasField) {
    switch (name) {
      case "status":
        return (
          <select
            className={selectClass}
            value={values.status}
            onChange={(e) => void save({ status: e.target.value })}
          >
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        );
      case "dueDate":
        return (
          <input
            type="date"
            className={inputClass}
            // Due dates are stored as UTC midnight; slicing the ISO string
            // (not local formatting) keeps the picked day stable.
            value={values.dueDate ? values.dueDate.slice(0, 10) : ""}
            onChange={(e) =>
              void save({ dueDate: e.target.value || null })
            }
          />
        );
      case "urgency":
        return (
          <select
            className={selectClass}
            value={values.urgency ?? ""}
            onChange={(e) =>
              void save({ urgency: e.target.value || null })
            }
          >
            <option value="">none</option>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        );
      case "meetingAt":
        return (
          <input
            type="datetime-local"
            className={inputClass}
            value={values.meetingAt ? toLocalInput(values.meetingAt) : ""}
            onChange={(e) =>
              void save({
                meetingAt: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : null,
              })
            }
          />
        );
      case "url":
        return (
          <input
            type="url"
            className={`${inputClass} w-56`}
            placeholder="https://"
            defaultValue={values.url ?? ""}
            // Free-text fields commit on blur/Enter, not per keystroke.
            onBlur={(e) => {
              const v = e.target.value.trim() || null;
              if (v !== values.url) void save({ url: v });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        );
    }
  }

  const labels: Record<CanvasField, string> = {
    status: "Status",
    dueDate: "Due",
    urgency: "Urgency",
    meetingAt: "When",
    url: "URL",
  };

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-12 pb-3">
      {fields.map((name) => (
        <label
          key={name}
          className="flex items-center gap-1.5 text-xs text-neutral-500"
        >
          {labels[name]}
          {field(name)}
        </label>
      ))}
      {error && (
        <span className="text-xs text-red-400">Save failed, change reverted</span>
      )}
    </div>
  );
}
