// The /dashboards index list, made manageable (R1a): Home/Today badges, inline
// rename, duplicate, delete-with-undo, and native drag-to-reorder. The page
// stays a server component; this owns the interactions.
//
// Every write goes through an existing endpoint — PATCH/DELETE
// /api/dashboards/[id], POST /api/dashboards, PUT /api/dashboards/reorder (the
// last two had zero callers until now). PATCH is a FULL replace of the
// dashboard, so a rename must send focusItemId + appearance + widgets back
// unchanged or it wipes the board; `payload()` is the one place that builds it.
// Drag is handle-gated native HTML5 (no DnD library, Principle 5) following the
// NavSlotsEditor pattern, so the row's link stays clickable. The list state here
// is optimistic and seeds at mount only — the page keys this component on the
// dashboard id set so a create/duplicate/undo/reorder refresh remounts it with
// server truth.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { showToast } from "@/components/ui/ActionToast";
import type {
  ContainerWidgetSettings,
  Dashboard,
  DashboardInput,
  DashboardWidget,
} from "@/lib/dashboard-widgets";

function payload(d: Dashboard): DashboardInput {
  return {
    name: d.name,
    focusItemId: d.focusItemId,
    appearance: d.appearance,
    widgets: d.widgets,
  };
}

// A duplicated board needs its own widget ids (they key react-grid-layout cells
// and the per-widget PATCH path), including inside a container's children.
function freshIds(widgets: DashboardWidget[]): DashboardWidget[] {
  return widgets.map((w) => ({
    ...w,
    id: crypto.randomUUID(),
    settings:
      w.kind === "container"
        ? {
            ...(w.settings as ContainerWidgetSettings),
            children: freshIds((w.settings as ContainerWidgetSettings).children ?? []),
          }
        : w.settings,
  }));
}

const iconBtn =
  "shrink-0 rounded px-1.5 py-1 text-ink-faint hover:bg-surface-2 hover:text-ink";

export default function DashboardIndexList({
  dashboards,
  homeId,
  todayId,
}: {
  dashboards: Dashboard[];
  homeId: string | null;
  todayId: string | null;
}) {
  const router = useRouter();
  const [list, setList] = useState(dashboards);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Any failed write: tell the user and resync from the server rather than
  // leaving the optimistic list lying about what's stored.
  function fail(what: string) {
    showToast(`Couldn't ${what}. Try again.`);
    setList(dashboards);
    router.refresh();
  }

  async function rename(d: Dashboard) {
    const name = draft.trim();
    setEditingId(null);
    if (!name || name === d.name) return;
    setList((prev) => prev.map((x) => (x.id === d.id ? { ...x, name } : x)));
    const res = await fetch(`/api/dashboards/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(d), name }),
    });
    if (!res.ok) return fail("rename that dashboard");
    router.refresh();
  }

  async function duplicate(d: Dashboard) {
    const res = await fetch("/api/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${d.name} copy`.slice(0, 120),
        focusItemId: null, // a copy starts unfocused
        appearance: d.appearance,
        widgets: freshIds(d.widgets),
      }),
    });
    if (!res.ok) return fail("duplicate that dashboard");
    router.refresh(); // stay on the index, the copy appears at the end
  }

  async function remove(d: Dashboard) {
    setList((prev) => prev.filter((x) => x.id !== d.id));
    const res = await fetch(`/api/dashboards/${d.id}`, { method: "DELETE" });
    if (!res.ok) return fail("delete that dashboard");
    // Undo re-CREATES the board from the payload held here, so it comes back
    // with a NEW id at the end of the order (and any Home/Today assignment or
    // saved link to the old id stays broken). Accepted: no restore endpoint and
    // the content — name, focus, appearance, widgets — is what matters.
    showToast("Dashboard deleted", () => {
      void fetch("/api/dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(d)),
      }).then((r) => (r.ok ? router.refresh() : fail("restore that dashboard")));
    });
    router.refresh();
  }

  // Live displacement while dragging (NavSlotsEditor's pattern): the working
  // list reorders as the held row passes another, and the new order persists
  // once on release.
  function onDragEnterRow(target: number) {
    if (dragIndex === null || dragIndex === target) return;
    setList((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setDragIndex(target);
  }

  function endDrag() {
    if (dragIndex === null) return;
    setDragIndex(null);
    void fetch("/api/dashboards/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboardIds: list.map((d) => d.id) }),
    }).then((r) => (r.ok ? router.refresh() : fail("save that order")));
  }

  if (list.length === 0) {
    return (
      <p className="mt-8 ui-meta text-ink-faint">
        No dashboards yet. Create one to start arranging widgets.
      </p>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-2">
      {list.map((d, i) => (
        <li
          key={d.id}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => onDragEnterRow(i)}
          onDrop={(e) => {
            e.preventDefault();
            endDrag();
          }}
          onDragEnd={endDrag}
          className={`flex items-center gap-2 rounded-card border bg-surface-1 px-3 py-2 transition-colors ${
            dragIndex === i ? "border-[var(--accent)] bg-surface-2" : "border-line"
          }`}
        >
          <span
            draggable
            onDragStart={() => setDragIndex(i)}
            title="Drag to reorder"
            className="shrink-0 cursor-grab select-none px-1 text-ink-faint"
            aria-hidden
          >
            ⠿
          </span>

          {editingId === d.id ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename(d);
                if (e.key === "Escape") setEditingId(null);
              }}
              onBlur={() => void rename(d)}
              aria-label="Dashboard name"
              className="min-w-0 flex-1 rounded border border-line-strong bg-surface-0 px-2 py-1 ui-row text-ink outline-none focus:border-[var(--accent)]"
            />
          ) : (
            <Link
              href={`/dashboards/${d.id}`}
              draggable={false}
              className="min-w-0 flex-1 truncate ui-row font-medium text-ink hover:text-[color:var(--accent)]"
            >
              {d.name}
            </Link>
          )}

          {[d.id === homeId && "Home", d.id === todayId && "Today"]
            .filter(Boolean)
            .map((role) => (
              <span
                key={role as string}
                className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 ui-meta uppercase tracking-wide text-ink-muted"
              >
                {role}
              </span>
            ))}

          <span className="shrink-0 ui-meta text-ink-subtle">
            {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"}
          </span>

          <button
            type="button"
            onClick={() => {
              setDraft(d.name);
              setEditingId(d.id);
            }}
            aria-label={`Rename ${d.name}`}
            title="Rename"
            className={iconBtn}
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => void duplicate(d)}
            aria-label={`Duplicate ${d.name}`}
            title="Duplicate"
            className={iconBtn}
          >
            ⧉
          </button>
          <button
            type="button"
            onClick={() => void remove(d)}
            aria-label={`Delete ${d.name}`}
            title="Delete"
            className={`${iconBtn} hover:text-red-400`}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
