// Embedded query view (slice 28, PRD §4.9): an interactive view dropped onto a
// host item (an entity). It runs an owner-scoped, body-free query filtered to
// items related to the host, and supports the four embedded-view behaviors:
//   - editable filter   — type/status/due selects refetch in place
//   - inline check-off   — toggle a task's done state without leaving
//   - create-inherits    — "+ Add" makes an item of the filtered type and
//                          relates it to the host (so it lands in the view)
//   - remove = un-relate — removing a row deletes the host↔item edge, never
//                          the item itself
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  type: string;
  title: string;
  status: string;
  dueDate: string | null;
  urgency: string | null;
};

const TYPES = ["task", "meeting", "note", "link"];
const dueFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const selectClass =
  "rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none focus:border-neutral-600";

export default function EmbeddedView({ hostId }: { hostId: string }) {
  const [type, setType] = useState("task");
  const [status, setStatus] = useState("open");
  const [due, setDue] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const dateField = type === "meeting" ? "meetingAt" : "dueDate";
    const p = new URLSearchParams({
      entityId: hostId,
      sort: dateField,
      dir: "asc",
    });
    if (type) p.set("type", type);
    if (status) p.set("status", status);
    // The window applies to the type's natural date — a meeting's "When",
    // otherwise the due date — so "meetings today" works here too.
    if (due) {
      p.set("due", due);
      p.set("dateField", dateField);
    }
    try {
      const res = await fetch(`/api/items/query?${p.toString()}`);
      if (!res.ok) {
        setError(`couldn't load (${res.status})`);
        return;
      }
      const data = (await res.json()) as { items: Row[] };
      setRows(data.items);
    } catch {
      setError("couldn't load (offline?)");
    } finally {
      setLoading(false);
    }
  }, [hostId, type, status, due]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function toggle(row: Row) {
    const next = row.status === "done" ? "open" : "done";
    // Optimistic: flip locally, then drop the row if it no longer matches an
    // active status filter. A failed PATCH refetches to the true state.
    setRows((rs) =>
      status && next !== status
        ? rs.filter((r) => r.id !== row.id)
        : rs.map((r) => (r.id === row.id ? { ...r, status: next } : r))
    );
    const res = await fetch(`/api/items/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) void load();
  }

  async function remove(row: Row) {
    if (
      !confirm(
        `Remove "${row.title || "Untitled"}" from this view? The item itself stays.`
      )
    ) {
      return;
    }
    const res = await fetch(
      `/api/items/${hostId}/relations?targetId=${row.id}`,
      { method: "DELETE" }
    );
    if (res.ok) setRows((rs) => rs.filter((r) => r.id !== row.id));
    else setError(`couldn't remove (${res.status})`);
  }

  async function add() {
    const title = newTitle.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type || "task", title }),
      });
      if (!created.ok) {
        setError(`couldn't add (${created.status})`);
        return;
      }
      const { item } = (await created.json()) as { item: { id: string } };
      // Inherit the filter: relate the new item to the host so it appears here.
      await fetch(`/api/items/${hostId}/relations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: item.id }),
      });
      setNewTitle("");
      await load();
    } catch {
      setError("couldn't add (offline?)");
    } finally {
      setBusy(false);
    }
  }

  const typeLabel = type ? `${type}s` : "items";

  return (
    <div className="mx-auto w-full max-w-3xl px-12 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 pb-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Related {typeLabel}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={selectClass}
            aria-label="Type"
          >
            <option value="">any type</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={selectClass}
            aria-label="Status"
          >
            <option value="">any status</option>
            <option value="open">open</option>
            <option value="done">done</option>
            <option value="archived">archived</option>
          </select>
          <select
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={selectClass}
            aria-label="Date window"
          >
            <option value="">any date</option>
            <option value="overdue">{type === "meeting" ? "past" : "overdue"}</option>
            <option value="today">today</option>
            <option value="week">next 7 days</option>
            <option value="none">no date</option>
          </select>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {loading ? (
        <p className="mt-2 px-2 text-sm text-neutral-600">Loading…</p>
      ) : rows.length > 0 ? (
        <ul className="mt-2">
          {rows.map((row) => {
            const done = row.status === "done";
            return (
              <li
                key={row.id}
                className="group flex items-center gap-2.5 rounded px-2 py-1 hover:bg-neutral-800/60"
              >
                {row.type === "task" ? (
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => void toggle(row)}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-neutral-400"
                    aria-label={done ? "Mark open" : "Mark done"}
                  />
                ) : (
                  <span className="w-12 shrink-0 truncate text-xs text-neutral-600">
                    {row.type}
                  </span>
                )}
                <Link
                  href={`/items/${row.id}`}
                  className={`min-w-0 flex-1 truncate text-sm ${
                    row.title ? "text-neutral-200" : "text-neutral-500"
                  } ${done ? "line-through opacity-60" : ""}`}
                >
                  {row.title || "Untitled"}
                </Link>
                {(row.urgency === "high" || row.urgency === "critical") && (
                  <span className="shrink-0 rounded bg-amber-950 px-1.5 text-xs text-amber-400">
                    {row.urgency}
                  </span>
                )}
                <span className="shrink-0 text-xs text-neutral-600">
                  {row.dueDate ? dueFmt.format(new Date(row.dueDate)) : ""}
                </span>
                <button
                  onClick={() => void remove(row)}
                  className="shrink-0 text-xs text-neutral-700 opacity-0 hover:text-red-400 group-hover:opacity-100"
                  title="Remove from this view (keeps the item)"
                >
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 px-2 text-sm text-neutral-600">
          Nothing related yet.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 px-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder={`+ Add ${type || "task"}`}
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-600 disabled:opacity-50"
        />
        <button
          onClick={() => void add()}
          disabled={busy || !newTitle.trim()}
          className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}
