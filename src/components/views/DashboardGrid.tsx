// Dashboard grid (slice 29, PRD §4.11): the pinned view widgets, arranged in a
// responsive grid that fills the screen on desktop and scrolls vertically on
// mobile. Cards drag-and-drop to reorder (native HTML5 DnD, no library — rule
// 5), persisting the order to /api/dashboard. Heights are content-driven by
// default; an equal-height toggle (a display preference, kept in localStorage)
// caps every card to a uniform scrollable height.
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useEffect } from "react";

export type DashboardWidget = {
  id: string;
  name: string;
  layout: string;
  count: number;
  items: {
    id: string;
    title: string;
    type: string;
    status: string;
    dueDate: string | null;
  }[];
};

const EQUAL_HEIGHT_KEY = "ledgr-dashboard-equal-height";
const dueFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

async function persistOrder(ids: string[]) {
  await fetch("/api/dashboard", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewIds: ids }),
  }).catch(() => {});
}

export default function DashboardGrid({
  initial,
}: {
  initial: DashboardWidget[];
}) {
  const [widgets, setWidgets] = useState(initial);
  const [equalHeight, setEqualHeight] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    setEqualHeight(localStorage.getItem(EQUAL_HEIGHT_KEY) === "1");
  }, []);

  function toggleEqual() {
    setEqualHeight((v) => {
      const next = !v;
      localStorage.setItem(EQUAL_HEIGHT_KEY, next ? "1" : "0");
      return next;
    });
  }

  function onDrop(targetIndex: number) {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragId(null);
    if (from === null || from === targetIndex) return;
    setWidgets((ws) => {
      const next = [...ws];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      void persistOrder(next.map((w) => w.id));
      return next;
    });
  }

  async function unpin(id: string) {
    setWidgets((ws) => ws.filter((w) => w.id !== id));
    await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewId: id, pinned: false }),
    }).catch(() => {});
  }

  return (
    <div>
      <div className="mt-2 flex justify-end">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={equalHeight}
            onChange={toggleEqual}
            className="h-3.5 w-3.5 accent-neutral-400"
          />
          Equal heights
        </label>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w, i) => (
          <section
            key={w.id}
            draggable
            onDragStart={() => {
              dragIndex.current = i;
              setDragId(w.id);
            }}
            onDragEnd={() => {
              dragIndex.current = null;
              setDragId(null);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(i)}
            className={`flex flex-col rounded-lg border bg-neutral-900/40 ${
              dragId === w.id
                ? "border-neutral-600 opacity-50"
                : "border-neutral-800"
            }`}
          >
            <header className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
              <span
                className="cursor-grab select-none text-neutral-700"
                title="Drag to reorder"
                aria-hidden
              >
                ⠿
              </span>
              <Link
                href={`/views/${w.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:text-neutral-100"
              >
                {w.name}
              </Link>
              <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
                {w.count}
              </span>
              <button
                onClick={() => void unpin(w.id)}
                className="shrink-0 text-neutral-700 hover:text-red-400"
                title="Remove from dashboard"
                aria-label="Remove from dashboard"
              >
                ✕
              </button>
            </header>
            <ul
              className={`flex flex-col gap-0.5 p-2 ${
                equalHeight ? "h-56 overflow-y-auto" : ""
              }`}
            >
              {w.items.length > 0 ? (
                w.items.map((item) => {
                  const done = item.status === "done";
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/items/${item.id}`}
                        className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-800/60"
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            item.title ? "text-neutral-300" : "text-neutral-500"
                          } ${done ? "line-through opacity-60" : ""}`}
                        >
                          {item.title || "Untitled"}
                        </span>
                        <span className="shrink-0 text-xs text-neutral-600">
                          {item.dueDate ? dueFmt.format(new Date(item.dueDate)) : ""}
                        </span>
                      </Link>
                    </li>
                  );
                })
              ) : (
                <li className="px-1.5 py-1 text-sm text-neutral-600">
                  No items match.
                </li>
              )}
              {w.count > w.items.length && (
                <li className="px-1.5 pt-1">
                  <Link
                    href={`/views/${w.id}`}
                    className="text-xs text-neutral-500 hover:text-neutral-300"
                  >
                    +{w.count - w.items.length} more →
                  </Link>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
