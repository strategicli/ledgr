// The per-type item-template builder (slice 34, PRD §4.3/§4.14): the form that
// creates/edits a `templates` row. It POSTs/PATCHes to /api/templates; the
// server (templates.ts) is the source of truth for validation. The starter
// body reuses the same Tiptap markdown editor items use (controlled here: a
// stable initial value + onChange, no item to autosave against), and the
// property defaults render controlled inputs off the selected type's schema —
// the mirror image of CustomProperties, which edits a live item.
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import LazyMarkdownEditor from "@/components/markdown-editor/LazyMarkdownEditor";
import type { ItemTemplate, RelationDefault } from "@/lib/templates";
import type { PropertyDef, TypeDefinition } from "@/lib/types";

type PersonOption = { id: string; title: string };

const fieldClass =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600 [color-scheme:dark]";

type Values = Record<string, unknown>;

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

// One controlled default input for a property def. Setting a value to empty
// removes the key, so a template only carries the defaults actually chosen.
function DefaultControl({
  prop,
  value,
  onChange,
}: {
  prop: PropertyDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (prop.kind) {
    case "text":
    case "url":
      return (
        <input
          type={prop.kind === "url" ? "url" : "text"}
          className={`${fieldClass} w-64`}
          placeholder={prop.kind === "url" ? "https://" : ""}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          className={`${fieldClass} w-32`}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") return onChange(null);
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(n);
          }}
        />
      );
    case "date":
      return (
        <input
          type="date"
          className={fieldClass}
          value={typeof value === "string" ? value.slice(0, 10) : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          className="ledgr-check"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked ? true : null)}
        />
      );
    case "select":
      return (
        <select
          className={fieldClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
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
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {prop.options?.map((o) => (
            <label key={o} className="flex items-center gap-1 text-sm text-neutral-300">
              <input
                type="checkbox"
                className="ledgr-check ledgr-check-sm"
                checked={selected.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, o]
                    : selected.filter((x) => x !== o);
                  onChange(next.length ? next : null);
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

export default function TemplateBuilder({
  types,
  people,
  initial,
  defaultType,
}: {
  types: TypeDefinition[];
  // The owner's people, so a template can pre-select the related items a new
  // item should start with — e.g. a meeting's usual attendees (Brandon
  // feedback, 2026-06-14).
  people: PersonOption[];
  initial?: ItemTemplate;
  defaultType?: string;
}) {
  const router = useRouter();
  const editing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [typeKey, setTypeKey] = useState(
    initial?.type ?? defaultType ?? types[0]?.key ?? ""
  );
  // The starter body. initialBodyMd is captured once (stable) for the editor;
  // bodyMd tracks edits — same split ItemEditor uses against a loaded body.
  const initialBodyMd = initial?.body?.text ?? "";
  const [bodyMd, setBodyMd] = useState(initialBodyMd);
  const [defaults, setDefaults] = useState<Values>(initial?.propertyDefaults ?? {});
  const [relations, setRelations] = useState<RelationDefault[]>(
    initial?.relationDefaults ?? []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const personTitle = (id: string) =>
    people.find((e) => e.id === id)?.title || "Untitled";
  // People not yet picked, for the "add" select.
  const available = people.filter(
    (e) => !relations.some((r) => r.targetId === e.id)
  );
  function addRelation(targetId: string) {
    if (!targetId) return;
    setRelations((rs) =>
      rs.some((r) => r.targetId === targetId)
        ? rs
        : [...rs, { targetId, role: "related" }]
    );
  }
  function removeRelation(targetId: string) {
    setRelations((rs) => rs.filter((r) => r.targetId !== targetId));
  }

  const selectedType = useMemo(
    () => types.find((t) => t.key === typeKey),
    [types, typeKey]
  );
  const schema = selectedType?.propertySchema ?? [];

  function setDefault(key: string, value: unknown) {
    setDefaults((d) => {
      const next = { ...d };
      if (value == null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function save() {
    if (busy) return;
    setError(null);
    if (!name.trim()) {
      setError("Give the template a name.");
      return;
    }
    if (!editing && !typeKey) {
      setError("Pick a type.");
      return;
    }
    setBusy(true);
    const payload = {
      name: name.trim(),
      body: bodyMd.trim() ? bodyMd : null,
      propertyDefaults: defaults,
      relationDefaults: relations,
      ...(editing ? {} : { type: typeKey }),
    };
    try {
      const res = await fetch(
        editing ? `/api/templates/${initial!.id}` : "/api/templates",
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
      router.push("/build/templates");
      router.refresh();
    } catch {
      setError("save failed (offline?)");
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || busy) return;
    if (!confirm(`Delete the "${initial!.name}" template?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${initial!.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `delete failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/build/templates");
      router.refresh();
    } catch {
      setError("delete failed (offline?)");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex max-w-2xl flex-col gap-4">
      <Field label="Name" hint="What this starting point is called, e.g. “Roger 1:1” or “Sermon outline”.">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Weekly review"
          className={fieldClass}
        />
      </Field>

      <Field
        label="Type"
        hint={
          editing
            ? "The item type this template creates; fixed once created."
            : "Which kind of item this template creates."
        }
      >
        <select
          value={typeKey}
          disabled={editing}
          onChange={(e) => {
            setTypeKey(e.target.value);
            setDefaults({}); // defaults are keyed to the type's schema
          }}
          className={`${fieldClass} ${editing ? "opacity-60" : ""}`}
        >
          {types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      {schema.length > 0 && (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Property defaults
          </legend>
          {schema.map((prop) => (
            <div key={prop.key} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 text-neutral-500">{prop.label}</span>
              <DefaultControl
                prop={prop}
                value={defaults[prop.key]}
                onChange={(v) => setDefault(prop.key, v)}
              />
            </div>
          ))}
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Related items
        </legend>
        <p className="text-xs text-neutral-600">
          Items a new one starts out linked to — e.g. the people who normally
          attend this meeting. They appear in its Related panel right away.
        </p>
        {relations.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {relations.map((r) => (
              <li
                key={r.targetId}
                className="flex items-center gap-1.5 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-200"
              >
                {personTitle(r.targetId)}
                <button
                  type="button"
                  aria-label={`Remove ${personTitle(r.targetId)}`}
                  onClick={() => removeRelation(r.targetId)}
                  className="text-neutral-500 hover:text-neutral-200"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {available.length > 0 ? (
          <select
            value=""
            onChange={(e) => addRelation(e.target.value)}
            className={`${fieldClass} w-64`}
            aria-label="Add a related item"
          >
            <option value="">Add a related item…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title || "Untitled"}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-neutral-600">
            {people.length === 0
              ? "No people yet — create people to relate them here."
              : "All people added."}
          </p>
        )}
      </fieldset>

      <Field label="Starter content" hint="The body new items begin with. Headings, checklists, agenda — whatever sets up the work.">
        <LazyMarkdownEditor initialMarkdown={initialBodyMd} onChange={setBodyMd} />
      </Field>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Create template"}
        </button>
        {editing && (
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
