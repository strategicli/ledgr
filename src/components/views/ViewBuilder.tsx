// View builder (slice 27, PRD §4.2/§4.9): the form that creates and edits a
// stored View Definition. It POSTs/PATCHes the whole definition to
// /api/views; the server (views.ts parseViewInput) is the source of truth for
// validation. Option lists are duplicated here as plain UI arrays so this
// client component never imports the DB-backed views module.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ViewDefinition } from "@/lib/views";

const LAYOUTS = ["list", "table", "board", "calendar", "agenda"] as const;
const TYPES = ["task", "meeting", "note", "link", "entity"];
const STATUSES = ["open", "done", "archived"];
const URGENCIES = ["low", "normal", "high", "critical"];
const DUE_WINDOWS = ["overdue", "today", "week", "none"];
const ENTITY_KINDS = ["person", "org", "project", "topic", "campus"];
const SORT_FIELDS = ["updatedAt", "createdAt", "dueDate", "meetingAt", "title"];
const GROUP_FIELDS = ["status", "urgency", "kind", "type", "due"];
const DATE_PROPERTIES = ["dueDate", "meetingAt", "createdAt", "updatedAt"];

type EntityOption = { id: string; title: string };

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

const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-600";

function Opt({ value, label }: { value: string; label?: string }) {
  return <option value={value}>{label ?? value}</option>;
}

export default function ViewBuilder({
  initial,
  entities,
}: {
  initial?: ViewDefinition;
  entities: EntityOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [layout, setLayout] = useState<string>(initial?.layout ?? "list");
  const [type, setType] = useState(initial?.filter.type ?? "");
  const [status, setStatus] = useState<string>(initial?.filter.status ?? "");
  const [urgency, setUrgency] = useState<string>(initial?.filter.urgency ?? "");
  const [due, setDue] = useState<string>(initial?.filter.due ?? "");
  const [kind, setKind] = useState(initial?.filter.kind ?? "");
  const [entityId, setEntityId] = useState(initial?.filter.entityId ?? "");
  const [sortField, setSortField] = useState<string>(
    initial?.sort.field ?? "updatedAt"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    initial?.sort.dir ?? "desc"
  );
  const [groupField, setGroupField] = useState<string>(
    initial?.grouping?.field ?? ""
  );
  const [dateProperty, setDateProperty] = useState<string>(
    initial?.dateProperty ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDate = layout === "calendar" || layout === "agenda";
  const canGroup = layout === "board" || layout === "agenda";

  async function save() {
    if (busy) return;
    setError(null);
    if (!name.trim()) {
      setError("Give the view a name.");
      return;
    }
    setBusy(true);
    const filter: Record<string, string> = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (urgency) filter.urgency = urgency;
    if (due) filter.due = due;
    if (kind) filter.kind = kind;
    if (entityId) filter.entityId = entityId;
    const payload = {
      name: name.trim(),
      layout,
      filter,
      sort: { field: sortField, dir: sortDir },
      grouping: canGroup && groupField ? { field: groupField } : null,
      dateProperty: needsDate ? dateProperty || "dueDate" : dateProperty || null,
    };
    try {
      const res = await fetch(
        initial ? `/api/views/${initial.id}` : "/api/views",
        {
          method: initial ? "PATCH" : "POST",
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
      const data = (await res.json()) as { view: { id: string } };
      router.push(`/views/${data.view.id}`);
      router.refresh();
    } catch {
      setError("save failed (offline?)");
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial || busy) return;
    if (!confirm("Delete this view? This can't be undone.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/views/${initial.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `delete failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.push("/views");
      router.refresh();
    } catch {
      setError("delete failed (offline?)");
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 flex max-w-md flex-col gap-4">
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. This week's tasks"
          className={selectClass}
        />
      </Field>

      <Field label="Layout">
        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value)}
          className={selectClass}
        >
          {LAYOUTS.map((l) => (
            <Opt key={l} value={l} />
          ))}
        </select>
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Filter
        </legend>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {TYPES.map((t) => (
              <Opt key={t} value={t} />
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {STATUSES.map((s) => (
              <Opt key={s} value={s} />
            ))}
          </select>
        </Field>
        <Field label="Urgency">
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {URGENCIES.map((u) => (
              <Opt key={u} value={u} />
            ))}
          </select>
        </Field>
        <Field label="Due window">
          <select
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            <Opt value="overdue" />
            <Opt value="today" />
            <Opt value="week" label="next 7 days" />
            <Opt value="none" label="no date" />
          </select>
        </Field>
        <Field label="Entity kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {ENTITY_KINDS.map((k) => (
              <Opt key={k} value={k} />
            ))}
          </select>
        </Field>
        <Field label="Related to entity">
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {entities.map((e) => (
              <Opt key={e.id} value={e.id} label={e.title || "Untitled"} />
            ))}
          </select>
        </Field>
      </fieldset>

      <div className="flex gap-3">
        <Field label="Sort by">
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className={selectClass}
          >
            {SORT_FIELDS.map((f) => (
              <Opt key={f} value={f} />
            ))}
          </select>
        </Field>
        <Field label="Direction">
          <select
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value as "asc" | "desc")}
            className={selectClass}
          >
            <Opt value="desc" label="newest / Z-A" />
            <Opt value="asc" label="oldest / A-Z" />
          </select>
        </Field>
      </div>

      {canGroup && (
        <Field label="Group by" hint="Columns for a board; sections for an agenda.">
          <select
            value={groupField}
            onChange={(e) => setGroupField(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label={layout === "board" ? "status (default)" : "none"} />
            {GROUP_FIELDS.map((g) => (
              <Opt key={g} value={g} />
            ))}
          </select>
        </Field>
      )}

      {needsDate && (
        <Field label="Date field" hint="Which date places items on the calendar/agenda.">
          <select
            value={dateProperty || "dueDate"}
            onChange={(e) => setDateProperty(e.target.value)}
            className={selectClass}
          >
            {DATE_PROPERTIES.map((d) => (
              <Opt key={d} value={d} />
            ))}
          </select>
        </Field>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Create view"}
        </button>
        {initial && !initial.isSystem && (
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
