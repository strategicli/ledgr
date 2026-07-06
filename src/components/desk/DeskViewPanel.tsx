// A saved view shown in a Desk panel (ADR-146, S4). A compact, body-free list
// of the view's items (via GET /api/views/[id]/items); clicking a row opens that
// item as a tab in this same panel, so the view stays put beside what you open.
// Board/calendar layouts keep their full pages — a Desk view panel is always the
// list shape, the useful "index beside a document" surface.
"use client";

import { useEffect, useState } from "react";

type ViewRow = {
  id: string;
  title: string | null;
  type: string;
  statusCategory: string | null;
  dueDate: string | null;
};

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; name: string; items: ViewRow[] };

export default function DeskViewPanel({
  viewId,
  onOpenItem,
}: {
  viewId: string;
  onOpenItem: (itemId: string) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    // Initial state is "loading"; the caller keys this component by viewId, so a
    // different view remounts fresh (no synchronous setState-in-effect needed).
    let cancelled = false;
    fetch(`/api/views/${viewId}/items`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        setState({
          status: "ready",
          name: d.view?.name ?? "View",
          items: Array.isArray(d.items) ? d.items : [],
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [viewId]);

  if (state.status === "loading")
    return <Message>Loading view…</Message>;
  if (state.status === "error")
    return <Message>Couldn’t load this view.</Message>;
  if (state.items.length === 0)
    return <Message>No items match this view.</Message>;

  return (
    <div className="h-full overflow-auto">
      <ul className="flex flex-col">
        {state.items.map((row) => {
          const done = row.statusCategory === "done";
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpenItem(row.id)}
                className="flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left text-sm hover:bg-surface-2"
              >
                <span
                  className={`truncate ${done ? "text-ink-faint line-through" : "text-ink"}`}
                >
                  {row.title?.trim() || "Untitled"}
                </span>
                <span className="ui-meta shrink-0 text-ink-faint">{row.type}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink-subtle">
      {children}
    </div>
  );
}
