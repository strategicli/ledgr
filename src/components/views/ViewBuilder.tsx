// View builder (slice 27, PRD §4.2/§4.9): the form that creates and edits a
// stored View Definition. It POSTs/PATCHes the whole definition to
// /api/views; the server (views.ts parseViewInput) is the source of truth for
// validation. Option lists are duplicated here as plain UI arrays so this
// client component never imports the DB-backed views module.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PropertyDef } from "@/lib/types";
import type { ViewDefinition } from "@/lib/views";

const LAYOUTS = ["list", "table", "board", "calendar", "agenda"] as const;
const STATUSES = ["open", "done", "archived"];
const URGENCIES = ["low", "normal", "high", "critical"];
const ENTITY_KINDS = ["person", "org", "project", "topic", "campus"];

// Friendly labels for the "by which field" selects.
const DATE_LABELS: Record<string, string> = {
  dueDate: "due date",
  meetingAt: "when",
  createdAt: "created",
  updatedAt: "updated",
};
const GROUP_LABELS: Record<string, string> = {
  status: "status",
  urgency: "urgency",
  kind: "kind",
  type: "type",
  due: "due window",
};

// The whole point of Brandon's feedback: a field is only offered if it exists
// for the view's type. Meetings have no due date, so a meeting view never lets
// you sort/place/filter by it; tasks have no "when"; notes/links have neither.
// Every field select below draws from these, and changeType() reconciles the
// current pick when the type changes.
function dateFieldsFor(type: string): string[] {
  if (type === "task") return ["dueDate", "createdAt", "updatedAt"];
  if (type === "meeting") return ["meetingAt", "createdAt", "updatedAt"];
  if (type === "") return ["dueDate", "meetingAt", "createdAt", "updatedAt"];
  return ["createdAt", "updatedAt"]; // note / link / entity
}
function sortFieldsFor(type: string): string[] {
  return [...dateFieldsFor(type), "title"];
}
// urgency + due window are task-only in the UI (ADR-018); kind is entity-only.
function groupFieldsFor(type: string): string[] {
  if (type === "task") return ["status", "urgency", "due", "type"];
  if (type === "meeting") return ["status", "type"];
  if (type === "entity") return ["status", "kind", "type"];
  if (type === "") return ["status", "urgency", "kind", "due", "type"];
  return ["status", "type"]; // note / link
}
const showsUrgency = (type: string) => type === "task" || type === "";
const showsKind = (type: string) => type === "entity" || type === "";

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
  types,
}: {
  initial?: ViewDefinition;
  entities: EntityOption[];
  // The full type registry (system + custom), so a view can filter to a
  // user-created type, not just the five system ones. propertySchema rides
  // along so a board can group by the type's select properties (a workflow's
  // "Stage", slice 35).
  types: { key: string; label: string; propertySchema?: PropertyDef[] }[];
}) {
  // A type's select/multi_select properties, as group-by options encoded
  // "prop:<key>" so they share the one Group-by control with the built-in
  // fields. A board grouped by one of these reads as a workflow board.
  function groupPropsFor(typeKey: string): { value: string; label: string }[] {
    const schema = types.find((t) => t.key === typeKey)?.propertySchema ?? [];
    return schema
      .filter((p) => p.kind === "select" || p.kind === "multi_select")
      .map((p) => ({ value: `prop:${p.key}`, label: p.label }));
  }
  const validGroup = (typeKey: string, val: string | undefined): string => {
    if (!val) return "";
    const ok =
      groupFieldsFor(typeKey).includes(val) ||
      groupPropsFor(typeKey).some((o) => o.value === val);
    return ok ? val : "";
  };
  // The stored grouping is {field} or {propertyKey}; collapse to the control's
  // string form ("status" | "prop:stage").
  const groupingToValue = (g: ViewDefinition["grouping"] | undefined): string =>
    g ? ("propertyKey" in g ? `prop:${g.propertyKey}` : g.field) : "";
  const router = useRouter();
  // Clamp anything the stored definition holds that's no longer valid for its
  // type (e.g. a legacy meeting calendar saved with date field "due date"):
  // it snaps to the first valid field, so editing + saving repairs it.
  const t0 = initial?.filter.type ?? "";
  const df0 = dateFieldsFor(t0);
  const pick = (allowed: string[], val: string | null | undefined, fallback: string) =>
    val && allowed.includes(val) ? val : fallback;

  const [name, setName] = useState(initial?.name ?? "");
  const [layout, setLayout] = useState<string>(initial?.layout ?? "list");
  const [type, setType] = useState(t0);
  const [status, setStatus] = useState<string>(initial?.filter.status ?? "");
  const [urgency, setUrgency] = useState<string>(
    showsUrgency(t0) ? initial?.filter.urgency ?? "" : ""
  );
  const [dateField, setDateField] = useState<string>(
    pick(df0, initial?.filter.dateField, df0[0])
  );
  // Window control: "" | overdue | today | week | none | "within". "within"
  // reveals the day-count input below.
  const [dateWindow, setDateWindow] = useState<string>(
    initial?.filter.withinDays != null ? "within" : initial?.filter.due ?? ""
  );
  const [withinDays, setWithinDays] = useState<string>(
    initial?.filter.withinDays != null ? String(initial.filter.withinDays) : "7"
  );
  const [kind, setKind] = useState(showsKind(t0) ? initial?.filter.kind ?? "" : "");
  const [entityId, setEntityId] = useState(initial?.filter.entityId ?? "");
  const [sortField, setSortField] = useState<string>(
    pick(sortFieldsFor(t0), initial?.sort.field, "updatedAt")
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    initial?.sort.dir ?? "desc"
  );
  const [groupField, setGroupField] = useState<string>(
    validGroup(t0, groupingToValue(initial?.grouping))
  );
  const [dateProperty, setDateProperty] = useState<string>(
    pick(df0, initial?.dateProperty, df0[0])
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsDate = layout === "calendar" || layout === "agenda";
  const canGroup = layout === "board" || layout === "agenda";
  const dateFields = dateFieldsFor(type);
  const sortFields = sortFieldsFor(type);
  const groupFields = groupFieldsFor(type);

  // Selecting a type reconciles every field pick to what that type supports —
  // the "lists update based on what the view shows" rule.
  function changeType(t: string) {
    setType(t);
    const df = dateFieldsFor(t);
    setDateField((v) => (df.includes(v) ? v : df[0]));
    setDateProperty((v) => (df.includes(v) ? v : df[0]));
    setSortField((v) => (sortFieldsFor(t).includes(v) ? v : "updatedAt"));
    setGroupField((v) => validGroup(t, v));
    if (!showsUrgency(t)) setUrgency("");
    if (!showsKind(t)) setKind("");
  }

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
    if (kind) filter.kind = kind;
    if (entityId) filter.entityId = entityId;
    if (dateWindow) {
      if (dateField) filter.dateField = dateField;
      if (dateWindow === "within") {
        const n = parseInt(withinDays, 10);
        if (!Number.isInteger(n) || n < 1) {
          setError("Enter a positive number of days.");
          setBusy(false);
          return;
        }
        filter.withinDays = String(n);
      } else {
        filter.due = dateWindow;
      }
    }
    const payload = {
      name: name.trim(),
      layout,
      filter,
      sort: { field: sortField, dir: sortDir },
      grouping:
        canGroup && groupField
          ? groupField.startsWith("prop:")
            ? { propertyKey: groupField.slice(5) }
            : { field: groupField }
          : null,
      dateProperty: needsDate ? dateProperty : null,
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
            onChange={(e) => changeType(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {types.map((t) => (
              <Opt key={t.key} value={t.key} label={t.label} />
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
        {showsUrgency(type) && (
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
        )}
        <Field
          label="Date filter"
          hint="Filter by a date, and which date it applies to."
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={dateField}
              onChange={(e) => setDateField(e.target.value)}
              className={selectClass}
              aria-label="Date field"
            >
              {dateFields.map((f) => (
                <Opt key={f} value={f} label={DATE_LABELS[f]} />
              ))}
            </select>
            <select
              value={dateWindow}
              onChange={(e) => setDateWindow(e.target.value)}
              className={selectClass}
              aria-label="Date window"
            >
              <Opt value="" label="any time" />
              <Opt value="overdue" label="in the past" />
              <Opt value="today" />
              <Opt value="week" label="next 7 days" />
              <Opt value="within" label="next N days…" />
              <Opt value="none" label="no date set" />
            </select>
            {dateWindow === "within" && (
              <span className="flex items-center gap-1 text-xs text-neutral-500">
                next
                <input
                  type="number"
                  min={1}
                  max={366}
                  value={withinDays}
                  onChange={(e) => setWithinDays(e.target.value)}
                  className="w-16 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-sm text-neutral-200 outline-none focus:border-neutral-600"
                  aria-label="Number of days"
                />
                days
              </span>
            )}
          </div>
        </Field>
        {showsKind(type) && (
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
        )}
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
            {sortFields.map((f) => (
              <Opt key={f} value={f} label={DATE_LABELS[f] ?? f} />
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
            {groupFields.map((g) => (
              <Opt key={g} value={g} label={GROUP_LABELS[g]} />
            ))}
            {groupPropsFor(type).map((o) => (
              <Opt key={o.value} value={o.value} label={`${o.label} (field)`} />
            ))}
          </select>
        </Field>
      )}

      {needsDate && (
        <Field
          label="Date field"
          hint={`Which date places items on the ${layout}.`}
        >
          <select
            value={dateProperty}
            onChange={(e) => setDateProperty(e.target.value)}
            className={selectClass}
          >
            {dateFields.map((d) => (
              <Opt key={d} value={d} label={DATE_LABELS[d]} />
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
