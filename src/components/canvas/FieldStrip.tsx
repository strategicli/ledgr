// The canvas top strip (PRD §4.13): the type's at-a-glance fields laid out
// horizontally as label-value pairs, one line instead of a Notion-style
// vertical stack. Every change PATCHes immediately and optimistically; a
// failure reverts to the server truth and says so.
"use client";

import { useState } from "react";
import type { CanvasField } from "@/lib/canvas-fields";
import { ITEM_STATUSES, URGENCIES } from "@/lib/item-enums";

export type StripValues = {
  status: string;
  dueDate: string | null; // ISO strings; Dates don't round-trip user edits
  urgency: string | null;
  meetingAt: string | null;
  url: string | null;
  kind: string | null;
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
  kindOptions = [],
}: {
  itemId: string;
  fields: CanvasField[];
  initial: StripValues;
  // Existing entity kinds to offer in the Kind picker (type-and-kind-ux §1);
  // empty for non-entity types, which don't show the field.
  kindOptions?: string[];
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState(false);
  // The Kind picker drops to a free-text input when "New kind…" is chosen.
  const [newKind, setNewKind] = useState(false);

  // One field per request is fine here: strip edits are single deliberate
  // clicks, not keystroke streams like the body autosave.
  async function save(patch: Partial<StripValues>) {
    const before = values;
    setValues((v) => ({ ...v, ...patch }));
    setError(false);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setValues(before);
      setError(true);
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
      case "kind": {
        // Free-text entry only while adding a new kind; otherwise a dropdown of
        // existing kinds so the same kind is reused, not retyped (§1).
        if (newKind) {
          return (
            <input
              type="text"
              autoFocus
              className={`${inputClass} w-28`}
              placeholder="new kind…"
              defaultValue=""
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                setNewKind(false);
                if (v !== values.kind) void save({ kind: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setNewKind(false);
              }}
            />
          );
        }
        // Current value may be a kind not in the suggestion list (legacy/import).
        const opts = Array.from(
          new Set([...kindOptions, ...(values.kind ? [values.kind] : [])])
        );
        return (
          <select
            className={selectClass}
            value={values.kind ?? ""}
            onChange={(e) => {
              if (e.target.value === "__new__") {
                setNewKind(true);
                return;
              }
              void save({ kind: e.target.value || null });
            }}
          >
            <option value="">—</option>
            {opts.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="__new__">＋ New kind…</option>
          </select>
        );
      }
    }
  }

  const labels: Record<CanvasField, string> = {
    status: "Status",
    dueDate: "Due",
    urgency: "Urgency",
    meetingAt: "When",
    url: "URL",
    kind: "Kind",
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
