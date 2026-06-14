// The custom type & property builder (slice 33, PRD §3.6/§4.10): the form that
// creates and edits a `types` row. It POSTs/PATCHes the whole definition to
// /api/types; the server (types.ts parseTypeInput) is the source of truth for
// validation. Kind labels are duplicated here as a plain client array so this
// component never imports the DB-backed types module (only its erased types).
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { PropertyDef, PropertyKind, TypeDefinition } from "@/lib/types";

// Mirrors PROPERTY_KINDS in src/lib/types.ts (validation lives there).
const KINDS: { kind: PropertyKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "date", label: "Date" },
  { kind: "checkbox", label: "Checkbox (yes/no)" },
  { kind: "url", label: "URL" },
  { kind: "select", label: "Select (one)" },
  { kind: "multi_select", label: "Multi-select" },
];
const NEEDS_OPTIONS: PropertyKind[] = ["select", "multi_select"];

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";

// Client-side slug, kept in step with the server SLUG_RE: lowercase, non-alnum
// to underscore, must start with a letter.
function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `f_${base}`;
}

// Editor row: a stable local id for React, the (immutable once set) property
// key, the editable label/kind, and options as raw comma-separated text.
type Row = {
  id: number;
  key: string; // "" for a new row; derived at save so a rename never orphans values
  label: string;
  kind: PropertyKind;
  optionsText: string;
};

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-neutral-600">{hint}</span>}
    </label>
  );
}

export default function TypeBuilder({
  initial,
  attached,
}: {
  initial?: TypeDefinition;
  // SPIKE (bespoke-tool catalog): the bespoke tool this type borrows, resolved
  // server-side to {id, label} so this client form never imports the registry.
  // Set when arriving from the catalog (new) or editing a type that has one.
  attached?: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const editing = !!initial;
  const isSystem = initial?.isSystem ?? false;
  const capability = attached?.id ?? null;

  const nextId = useRef(0);
  const makeRow = (p?: PropertyDef): Row => ({
    id: nextId.current++,
    key: p?.key ?? "",
    label: p?.label ?? "",
    kind: p?.kind ?? "text",
    optionsText: p?.options?.join(", ") ?? "",
  });

  const [label, setLabel] = useState(initial?.label ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [keyEdited, setKeyEdited] = useState(editing); // don't auto-fill once editing/typed
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [showInQuickCapture, setShowInQuickCapture] = useState(
    initial?.showInQuickCapture ?? true
  );
  const [rows, setRows] = useState<Row[]>(
    initial?.propertySchema.map((p) => makeRow(p)) ?? []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeLabel(v: string) {
    setLabel(v);
    if (!editing && !keyEdited) setKey(slugify(v));
  }

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function moveRow(id: number, dir: -1 | 1) {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  // Build the PropertyDef[] payload: derive a stable key for new rows, ensure
  // keys are unique (suffixing collisions), and split option text.
  function buildSchema(): { schema: PropertyDef[]; error?: string } {
    const used = new Set<string>();
    const schema: PropertyDef[] = [];
    for (const r of rows) {
      const propLabel = r.label.trim();
      if (!propLabel) return { schema, error: "Every property needs a label." };
      let k = r.key || slugify(propLabel) || "field";
      while (used.has(k)) k = `${k}_2`;
      used.add(k);
      const def: PropertyDef = { key: k, label: propLabel, kind: r.kind };
      if (NEEDS_OPTIONS.includes(r.kind)) {
        const options = Array.from(
          new Set(
            r.optionsText
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          )
        );
        if (options.length === 0) {
          return { schema, error: `"${propLabel}" needs at least one option.` };
        }
        def.options = options;
      }
      schema.push(def);
    }
    return { schema };
  }

  async function save() {
    if (busy) return;
    setError(null);
    if (!label.trim()) {
      setError("Give the type a name.");
      return;
    }
    const finalKey = editing ? initial!.key : key || slugify(label);
    if (!editing && !finalKey) {
      setError("Give the type a key (letters, digits, underscore).");
      return;
    }
    const { schema, error: schemaError } = buildSchema();
    if (schemaError) {
      setError(schemaError);
      return;
    }
    setBusy(true);
    const payload = {
      label: label.trim(),
      icon: icon.trim() || null,
      showInQuickCapture,
      propertySchema: schema,
      capability, // SPIKE: the borrowed bespoke tool (null for a plain type)
      ...(editing ? {} : { key: finalKey }),
    };
    try {
      const res = await fetch(
        editing ? `/api/types/${initial!.key}` : "/api/types",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `save failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/build/types");
      router.refresh();
    } catch {
      setError("save failed (offline?)");
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || busy) return;
    if (!confirm(`Delete the "${initial!.label}" type? This can't be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/types/${initial!.key}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `delete failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/build/types");
      router.refresh();
    } catch {
      setError("delete failed (offline?)");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex max-w-xl flex-col gap-4">
      {attached && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-sm">
          <span className="text-neutral-500">Bespoke tool: </span>
          <span className="font-medium text-neutral-200">{attached.label}</span>
          <p className="mt-0.5 text-xs text-neutral-500">
            This type will use the {attached.label} canvas. Give it any name you
            like.
          </p>
        </div>
      )}
      <Field label="Name">
        <input
          value={label}
          onChange={(e) => changeLabel(e.target.value)}
          placeholder="e.g. Hiring Candidate"
          className={selectClass}
        />
      </Field>

      <Field
        label="Key"
        hint={
          editing
            ? "The internal id this type is stored under. Fixed once created so existing items don't break."
            : "The internal id this type is stored under (lowercase, no spaces). Auto-filled from the name; you rarely need to change it."
        }
      >
        <input
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setKeyEdited(true);
          }}
          disabled={editing}
          placeholder="hiring_candidate"
          className={`${selectClass} font-mono ${editing ? "opacity-60" : ""}`}
        />
      </Field>

      <div className="flex flex-wrap items-end gap-4">
        <Field
          label="Icon"
          hint="Optional. The name of an icon shown next to this type, e.g. music, file-text, user-plus."
        >
          <input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="e.g. file-text"
            className={`${selectClass} w-40`}
          />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={showInQuickCapture}
            onChange={(e) => setShowInQuickCapture(e.target.checked)}
            className="h-4 w-4 accent-neutral-300"
          />
          Show in quick capture
        </label>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Properties
        </legend>
        {rows.length === 0 && (
          <p className="px-1 text-sm text-neutral-600">
            No custom properties yet. Add fields this type should carry.
          </p>
        )}
        {rows.map((row, i) => (
          <div
            key={row.id}
            className="flex flex-col gap-2 rounded border border-neutral-800/70 bg-neutral-900/40 p-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={row.label}
                onChange={(e) => updateRow(row.id, { label: e.target.value })}
                placeholder="Field name"
                aria-label="Property label"
                className={`${selectClass} min-w-0 flex-1`}
              />
              <select
                value={row.kind}
                onChange={(e) =>
                  updateRow(row.id, { kind: e.target.value as PropertyKind })
                }
                aria-label="Property kind"
                className={selectClass}
              >
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center">
                <button
                  onClick={() => moveRow(row.id, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveRow(row.id, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                  className="rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => removeRow(row.id)}
                  aria-label="Remove property"
                  className="rounded px-1.5 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            </div>
            {NEEDS_OPTIONS.includes(row.kind) && (
              <input
                value={row.optionsText}
                onChange={(e) =>
                  updateRow(row.id, { optionsText: e.target.value })
                }
                placeholder="Comma-separated options, e.g. Applied, Interview, Offer"
                aria-label="Options"
                className={`${selectClass} w-full`}
              />
            )}
          </div>
        ))}
        <button
          onClick={() => setRows((rs) => [...rs, makeRow()])}
          className="self-start rounded border border-neutral-800 px-2.5 py-1 text-sm text-neutral-300 hover:border-neutral-700 hover:bg-neutral-800/60"
        >
          + Add property
        </button>
      </fieldset>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Create type"}
        </button>
        {editing && !isSystem && (
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            Delete
          </button>
        )}
        {isSystem && (
          <span className="text-xs text-neutral-600">
            Built-in type — can be extended, not deleted.
          </span>
        )}
      </div>
    </div>
  );
}
