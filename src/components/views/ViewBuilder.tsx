// View builder (slice 27, PRD §4.2/§4.9): the form that creates and edits a
// stored View Definition. It POSTs/PATCHes the whole definition to
// /api/views; the server (views.ts parseViewInput) is the source of truth for
// validation. Option lists are duplicated here as plain UI arrays so this
// client component never imports the DB-backed views module.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PropertyDef } from "@/lib/types";
import type { ColumnField, ViewColumn, ViewDefinition } from "@/lib/views";

const LAYOUTS = ["list", "table", "board", "calendar", "agenda"] as const;
const STATUSES = ["open", "done", "archived"];
const URGENCIES = ["low", "normal", "high", "critical"];

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
  return ["createdAt", "updatedAt"]; // note / link / person
}
function sortFieldsFor(type: string): string[] {
  return [...dateFieldsFor(type), "title"];
}
// urgency + due window are task-only in the UI (ADR-018).
function groupFieldsFor(type: string): string[] {
  if (type === "task") return ["status", "urgency", "due", "type"];
  if (type === "meeting") return ["status", "type"];
  if (type === "") return ["status", "urgency", "due", "type"];
  return ["status", "type"]; // note / link / person
}
const showsUrgency = (type: string) => type === "task" || type === "";

// Columns are offered for the row-based layouts (list/table/agenda); board and
// calendar have their own card shapes and ignore the column choice.
const showsColumns = (layout: string) =>
  layout === "list" || layout === "table" || layout === "agenda";

// Built-in field columns offered for a type, mirroring which fields that type
// actually has (the same discipline as the date/sort selects above).
const FIELD_COLUMN_LABELS: Record<ColumnField, string> = {
  type: "Type",
  status: "Status",
  urgency: "Urgency",
  dueDate: "Due date",
  meetingAt: "When",
  createdAt: "Created",
  updatedAt: "Updated",
  url: "URL",
};
function fieldColumnsFor(type: string): ColumnField[] {
  const cols: ColumnField[] = ["type", "status"];
  if (showsUrgency(type)) cols.push("urgency");
  for (const d of dateFieldsFor(type)) cols.push(d as ColumnField);
  if (type === "link" || type === "") cols.push("url");
  return cols;
}

type PersonOption = { id: string; title: string };

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
  people,
  types,
}: {
  initial?: ViewDefinition;
  people: PersonOption[];
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
  // The type's custom properties, offered as property columns.
  function propColumnsFor(typeKey: string): { key: string; label: string }[] {
    const schema = types.find((t) => t.key === typeKey)?.propertySchema ?? [];
    return schema.map((p) => ({ key: p.key, label: p.label }));
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
  const [relatedTo, setRelatedTo] = useState(initial?.filter.relatedTo ?? "");
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
  // Chosen columns, in order; empty = the layout's default columns. Toggling
  // appends (so check order = column order) or removes.
  const [columns, setColumns] = useState<ViewColumn[]>(initial?.columns ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasColumn = (col: ViewColumn) =>
    columns.some((c) => c.source === col.source && c.key === col.key);
  function toggleColumn(col: ViewColumn) {
    setColumns((cs) =>
      cs.some((c) => c.source === col.source && c.key === col.key)
        ? cs.filter((c) => !(c.source === col.source && c.key === col.key))
        : [...cs, col]
    );
  }

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
    // Drop any column the new type doesn't have (a stale field or a property
    // key that isn't in the new type's schema).
    const okFields = new Set<string>(fieldColumnsFor(t));
    const okProps = new Set(propColumnsFor(t).map((p) => p.key));
    setColumns((cs) =>
      cs.filter((c) =>
        c.source === "field" ? okFields.has(c.key) : okProps.has(c.key)
      )
    );
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
    if (relatedTo) filter.relatedTo = relatedTo;
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
      columns: showsColumns(layout) && columns.length ? columns : null,
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
        <Field label="Related to person">
          <select
            value={relatedTo}
            onChange={(e) => setRelatedTo(e.target.value)}
            className={selectClass}
          >
            <Opt value="" label="any" />
            {people.map((p) => (
              <Opt key={p.id} value={p.id} label={p.title || "Untitled"} />
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

      {showsColumns(layout) && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Columns
          </legend>
          <p className="text-xs text-neutral-600">
            Which fields show beside each item. None checked = the default
            (status, urgency, date).
          </p>
          <div className="flex flex-col gap-1.5">
            {fieldColumnsFor(type).map((key) => {
              const col: ViewColumn = { source: "field", key };
              return (
                <label key={`field:${key}`} className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-neutral-300"
                    checked={hasColumn(col)}
                    onChange={() => toggleColumn(col)}
                  />
                  {FIELD_COLUMN_LABELS[key]}
                </label>
              );
            })}
            {propColumnsFor(type).map(({ key, label }) => {
              const col: ViewColumn = { source: "property", key };
              return (
                <label key={`property:${key}`} className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-neutral-300"
                    checked={hasColumn(col)}
                    onChange={() => toggleColumn(col)}
                  />
                  {label}{" "}
                  <span className="text-xs text-neutral-600">(property)</span>
                </label>
              );
            })}
          </div>
        </fieldset>
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
