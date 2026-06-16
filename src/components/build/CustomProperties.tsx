// The editable custom-property panel on the item canvas (slice 33, PRD §3.6):
// renders a type's property_schema as inputs over items.properties and PATCHes
// on change, the same optimistic-with-revert pattern as the FieldStrip.
//
// items.properties also holds namespaced system keys (email/todoist/calendar/
// match/notify), so this never sends only the schema fields — it keeps the full
// properties object in state and overlays the edited field, so a PATCH can't
// wipe a system key the schema doesn't know about.
"use client";

import { useState } from "react";
import type { PropertyDef } from "@/lib/types";
import InlineLabel from "./InlineLabel";

const inputClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 [color-scheme:dark]";

type Values = Record<string, unknown>;

export default function CustomProperties({
  itemId,
  typeKey,
  schema,
  initial,
}: {
  itemId: string;
  typeKey: string;
  schema: PropertyDef[];
  initial: Values;
}) {
  const [values, setValues] = useState<Values>(initial ?? {});
  const [error, setError] = useState(false);
  // Remount key per field, bumped when the × clears a value. The text/url/number
  // inputs are uncontrolled (defaultValue, to avoid per-keystroke re-render), so
  // clearing state alone wouldn't empty the visible box — remounting reads the
  // now-null state as a fresh empty defaultValue. Controlled kinds ignore it.
  const [rev, setRev] = useState<Record<string, number>>({});

  // Merge the change into the full object and PATCH the whole thing (updateItem
  // replaces properties wholesale). Revert to the prior object on failure.
  async function save(patch: Values) {
    const before = values;
    const next = { ...values, ...patch };
    setValues(next);
    setError(false);
    try {
      const res = await fetch(`/api/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setValues(before);
      setError(true);
    }
  }

  function control(prop: PropertyDef) {
    const v = values[prop.key];
    switch (prop.kind) {
      case "text":
        return (
          <input
            key={`${prop.key}:${rev[prop.key] ?? 0}`}
            type="text"
            className={`${inputClass} w-56`}
            defaultValue={typeof v === "string" ? v : ""}
            onBlur={(e) => {
              const nv = e.target.value.trim() || null;
              if (nv !== (v ?? null)) void save({ [prop.key]: nv });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        );
      case "url":
        return (
          <input
            key={`${prop.key}:${rev[prop.key] ?? 0}`}
            type="url"
            className={`${inputClass} w-56`}
            placeholder="https://"
            defaultValue={typeof v === "string" ? v : ""}
            onBlur={(e) => {
              const nv = e.target.value.trim() || null;
              if (nv !== (v ?? null)) void save({ [prop.key]: nv });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        );
      case "number":
        return (
          <input
            key={`${prop.key}:${rev[prop.key] ?? 0}`}
            type="number"
            className={`${inputClass} w-32`}
            defaultValue={typeof v === "number" ? String(v) : ""}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const nv = raw === "" ? null : Number(raw);
              if (nv !== null && Number.isNaN(nv)) return;
              if (nv !== (typeof v === "number" ? v : null)) {
                void save({ [prop.key]: nv });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        );
      case "date":
        return (
          <input
            type="date"
            className={inputClass}
            value={typeof v === "string" ? v.slice(0, 10) : ""}
            onChange={(e) => void save({ [prop.key]: e.target.value || null })}
          />
        );
      case "checkbox":
        return (
          <input
            type="checkbox"
            className="ledgr-check"
            checked={v === true}
            onChange={(e) => void save({ [prop.key]: e.target.checked })}
          />
        );
      case "select":
        return (
          <select
            className={inputClass}
            value={typeof v === "string" ? v : ""}
            onChange={(e) => void save({ [prop.key]: e.target.value || null })}
          >
            <option value="">—</option>
            {prop.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case "multi_select": {
        const selected = Array.isArray(v) ? (v as string[]) : [];
        return (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {prop.options?.map((o) => (
              <label key={o} className="flex items-center gap-1 text-neutral-300">
                <input
                  type="checkbox"
                  className="ledgr-check ledgr-check-sm"
                  checked={selected.includes(o)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, o]
                      : selected.filter((x) => x !== o);
                    void save({ [prop.key]: next });
                  }}
                />
                {o}
              </label>
            ))}
          </span>
        );
      }
    }
  }

  // Relation kinds (ADR-067) don't live in items.properties — their value is a
  // set of relations edges with role = the field key, rendered by the typed
  // relation input (RelationProperties), not here. Skip them so this scalar
  // panel doesn't draw an empty control for them.
  const scalarSchema = schema.filter((p) => p.kind !== "relation");
  if (scalarSchema.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pb-6 pt-2">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        Properties
      </h2>
      <dl className="flex flex-col gap-2">
        {scalarSchema.map((prop) => {
          const v = values[prop.key];
          // A value worth offering an explicit clear for. Checkbox has no
          // "empty" state (the toggle is the control), so it's excluded.
          const filled =
            prop.kind !== "checkbox" &&
            v != null &&
            v !== "" &&
            !(Array.isArray(v) && v.length === 0);
          return (
            <div key={prop.key} className="group flex items-center gap-3 text-sm">
              <dt className="w-32 shrink-0 text-neutral-500">
                <InlineLabel
                  typeKey={typeKey}
                  propertyKey={prop.key}
                  label={prop.label}
                />
              </dt>
              <dd className="flex min-w-0 items-center gap-1">
                {control(prop)}
                {filled && (
                  <button
                    type="button"
                    onClick={() => {
                      void save({ [prop.key]: null });
                      setRev((r) => ({ ...r, [prop.key]: (r[prop.key] ?? 0) + 1 }));
                    }}
                    aria-label={`Clear ${prop.label}`}
                    title="Clear"
                    className="shrink-0 rounded px-0.5 text-xs text-neutral-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 max-sm:opacity-100"
                  >
                    ✕
                  </button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {error && (
        <p className="mt-2 text-xs text-red-400">Save failed, change reverted</p>
      )}
    </section>
  );
}
