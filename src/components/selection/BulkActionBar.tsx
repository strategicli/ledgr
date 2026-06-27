// Floating bulk-action bar for the multi-select layer (ADR-118). Appears,
// fixed at the bottom, once at least one row is selected; reads the selection
// from context and acts on it through the /api/items/batch helpers. After a
// successful action it refreshes the server-rendered list and clears the
// selection.
//
// Actions (the set the surface offers is config-driven, so a mixed-type surface
// can hide what it can't honor):
//   - Set…   pick a field (status, a select property, or a date) + a value,
//            applied to every selected row. The seam where bulk Archive will
//            slot in once Ledgr grows an archive feature.
//   - Move…  search the owner's items and reparent every selection under the
//            pick (or send them to the top level). Mirrors AddRelation's
//            typeahead.
//   - Delete soft-delete to Trash (cascades to children), behind ConfirmButton.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { bulkDelete, bulkPatch, type BulkResult } from "@/components/selection/bulk-actions";
import { useSelection } from "@/components/selection/SelectionProvider";
import type { BulkActionConfig } from "@/lib/bulk-config";
import { orderedStatuses, type StatusDef } from "@/lib/status";

// A field the Set… menu can write. Status and dates are built in; the rest come
// from the type's select/multi_select properties.
type SetField =
  | { kind: "status"; statuses: StatusDef[] }
  | { kind: "select"; key: string; label: string; options: string[] }
  | { kind: "multi_select"; key: string; label: string; options: string[] }
  | { kind: "date"; key: "dueDate" | "scheduledDate"; label: string };

type Hit = { id: string; type: string; title: string };

export default function BulkActionBar(config: BulkActionConfig) {
  const router = useRouter();
  const { count, selected, clear } = useSelection();
  const [menu, setMenu] = useState<null | "set" | "move">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (count === 0) return null;

  const ids = () => Array.from(selected);

  function report(result: BulkResult) {
    if (result.errors.length > 0) {
      setError(
        `${result.count} updated, ${result.errors.length} failed: ${result.errors[0].error}`
      );
    } else {
      setError(null);
    }
  }

  async function run(fn: () => Promise<BulkResult>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      report(result);
      setMenu(null);
      router.refresh();
      if (result.errors.length === 0) clear();
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Build the Set… field list from config.
  const setFields: SetField[] = [];
  if (config.statuses && config.statuses.length > 0) {
    setFields.push({ kind: "status", statuses: config.statuses });
  }
  for (const f of config.propertyFields ?? []) {
    setFields.push({ kind: f.kind, key: f.key, label: f.label, options: f.options });
  }
  for (const key of config.dateFields ?? []) {
    setFields.push({ kind: "date", key, label: key === "dueDate" ? "Due date" : "Scheduled date" });
  }

  const btn =
    "rounded-md px-2.5 py-1 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50";

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-900 px-2 py-1.5 shadow-xl shadow-black/50">
        <span className="px-2 text-sm font-medium text-neutral-100">
          {count} selected
        </span>
        <span className="mx-1 h-5 w-px bg-neutral-700" aria-hidden />

        {/* Set… */}
        {setFields.length > 0 && (
          <div className="relative">
            <button
              type="button"
              className={btn}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={menu === "set"}
              onClick={() => setMenu((m) => (m === "set" ? null : "set"))}
            >
              Set…
            </button>
            {menu === "set" && (
              <SetMenu
                fields={setFields}
                busy={busy}
                onApply={(patch) => run(() => bulkPatch(ids(), patch))}
              />
            )}
          </div>
        )}

        {/* Move… */}
        <div className="relative">
          <button
            type="button"
            className={btn}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menu === "move"}
            onClick={() => setMenu((m) => (m === "move" ? null : "move"))}
          >
            Move…
          </button>
          {menu === "move" && (
            <MoveMenu
              busy={busy}
              onMove={(parentId) => run(() => bulkPatch(ids(), { parentId }))}
            />
          )}
        </div>

        {/* Delete */}
        <ConfirmButton
          trigger="Delete"
          triggerClassName={`${btn} text-red-300 hover:bg-red-950 hover:text-red-200`}
          align="right"
          title={`Delete ${count} item${count === 1 ? "" : "s"}?`}
          description="They move to Trash (with any sub-items) and are purged after 30 days."
          confirmLabel="Delete"
          disabled={busy}
          onConfirm={async () => {
            const result = await bulkDelete(ids());
            report(result);
            router.refresh();
            if (result.errors.length === 0) clear();
            else throw new Error(`${result.errors.length} failed: ${result.errors[0].error}`);
          }}
        />

        <span className="mx-1 h-5 w-px bg-neutral-700" aria-hidden />
        <button
          type="button"
          onClick={clear}
          className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
          aria-label="Clear selection"
        >
          Clear
        </button>

        {error && (
          <span className="ml-1 max-w-xs truncate text-xs text-red-400" title={error}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

// The Set… popover: a field column on the left, the chosen field's values on the
// right. Keeps everything in one small panel (no nested menus).
function SetMenu({
  fields,
  busy,
  onApply,
}: {
  fields: SetField[];
  busy: boolean;
  onApply: (patch: Record<string, unknown>) => void;
}) {
  const [field, setField] = useState<SetField>(fields[0]);
  const [date, setDate] = useState("");

  return (
    <div
      role="menu"
      className="absolute bottom-full left-0 mb-2 flex w-[22rem] max-w-[90vw] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl shadow-black/50"
    >
      <ul className="w-1/2 shrink-0 overflow-y-auto border-r border-neutral-800 py-1">
        {fields.map((f) => {
          const label =
            f.kind === "status" ? "Status" : f.label;
          const active = fieldKey(f) === fieldKey(field);
          return (
            <li key={fieldKey(f)}>
              <button
                type="button"
                onClick={() => setField(f)}
                className={`w-full truncate px-3 py-1.5 text-left text-sm ${
                  active ? "bg-neutral-800 text-neutral-100" : "text-neutral-300 hover:bg-neutral-800/60"
                }`}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="max-h-64 w-1/2 overflow-y-auto py-1">
        {field.kind === "status" &&
          orderedStatuses(field.statuses).map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={busy}
              onClick={() => onApply({ status: s.key })}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
            >
              <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.label}</span>
            </button>
          ))}

        {(field.kind === "select" || field.kind === "multi_select") && (
          <>
            {field.options.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={busy}
                onClick={() =>
                  onApply({
                    propertyPatch: {
                      [field.key]: field.kind === "multi_select" ? [opt] : opt,
                    },
                  })
                }
                className="block w-full truncate px-3 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => onApply({ propertyPatch: { [field.key]: null } })}
              className="block w-full px-3 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-800 disabled:opacity-50"
            >
              Clear value
            </button>
          </>
        )}

        {field.kind === "date" && (
          <div className="p-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onApply({ [field.key]: null })}
                className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-800 disabled:opacity-50"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={busy || !date}
                onClick={() => onApply({ [field.key]: date })}
                className="rounded bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Set
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fieldKey(f: SetField): string {
  return f.kind === "status" ? "status" : f.key;
}

// The Move… popover: typeahead over the owner's items (same q= search as
// AddRelation), plus a "Move to top level" escape. Picking applies parentId to
// the whole selection.
function MoveMenu({
  busy,
  onMove,
}: {
  busy: boolean;
  onMove: (parentId: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const trimmed = q.trim();

  // Empty queries clear hits in the onChange handler, not here, so the effect
  // only ever talks to the network (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!trimmed) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items?q=${encodeURIComponent(trimmed)}&limit=8`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items: Hit[] };
        setHits(data.items);
      } catch {
        // aborted/offline; next keystroke retries
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [trimmed]);

  return (
    <div
      role="menu"
      className="absolute bottom-full left-0 mb-2 w-72 max-w-[90vw] rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl shadow-black/50"
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (!e.target.value.trim()) setHits([]);
        }}
        disabled={busy}
        placeholder="Search items to move under…"
        className="w-full rounded border border-neutral-700 bg-transparent px-2 py-1 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none disabled:opacity-50"
      />
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {hits.map((hit) => (
          <li key={hit.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onMove(hit.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              <span className="min-w-0 flex-1 truncate">{hit.title || "Untitled"}</span>
              <span className="shrink-0 text-xs text-neutral-500">{hit.type}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={() => onMove(null)}
        className="mt-1 block w-full rounded px-2 py-1 text-left text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-50"
      >
        Move to top level
      </button>
    </div>
  );
}
