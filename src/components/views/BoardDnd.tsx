// Drag-and-drop for board (kanban) views: drag a card to another column to set
// its grouping value (status, urgency, or a single-select property). Mounted by
// BoardLayout only when the page deems the grouping safe to set by a drop
// (ViewRenderer's boardDraggable) — computed `due` buckets, `type`, and
// multi_select stay read-only. Native HTML5 drag (the NavSlotsEditor pattern,
// no DnD dependency, Principle 5); a drop optimistically moves the card,
// PATCHes /api/items/[id], then router.refresh() reconciles with the server.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ITEM_STATUSES, URGENCIES } from "@/lib/item-enums";
import { boardDropPatch, groupValueFor, NONE_GROUP, orderedGroups } from "@/lib/view-grouping";
import type { ViewGrouping } from "@/lib/views";

// What the board needs to group + render a card. dateLabel is precomputed by
// the server BoardLayout so the client needn't reimplement the date calendars.
export type BoardCard = {
  id: string;
  title: string;
  status: string;
  urgency: string | null;
  type: string;
  dueDate: Date | null;
  scheduledDate: Date | null;
  properties: unknown;
  dateLabel: string;
};

// Optimistically rewrite a card's grouping value so it re-buckets immediately;
// mirrors the effect of boardDropPatch on the server row.
function moveCard(card: BoardCard, grouping: ViewGrouping, col: string): BoardCard {
  if (grouping && "propertyKey" in grouping) {
    const props =
      card.properties && typeof card.properties === "object"
        ? { ...(card.properties as Record<string, unknown>) }
        : {};
    props[grouping.propertyKey] = col === NONE_GROUP ? null : col;
    return { ...card, properties: props };
  }
  const field = grouping?.field ?? "status";
  if (field === "status") return { ...card, status: col };
  if (field === "urgency") return { ...card, urgency: col === NONE_GROUP ? null : col };
  return card;
}

export default function BoardDnd({
  cards,
  grouping,
  groupOrder,
}: {
  cards: BoardCard[];
  grouping: ViewGrouping;
  groupOrder?: string[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(cards);
  // Reconcile with the server when it sends new cards (after router.refresh()):
  // adjust state during render, React's blessed alternative to a syncing effect
  // (and what the react-hooks rule wants). `cards` is a stable reference between
  // refreshes, so a client-only drag never resets the optimistic move.
  const [syncedFrom, setSyncedFrom] = useState(cards);
  if (syncedFrom !== cards) {
    setSyncedFrom(cards);
    setItems(cards);
  }
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const now = new Date();
  // Show every valid target column, including empty ones, so a card can be
  // dragged into a status/option that nothing currently has (orderedGroups
  // otherwise renders only present values).
  const fullKnown: string[] =
    grouping && "propertyKey" in grouping
      ? [...(groupOrder ?? []), NONE_GROUP]
      : (grouping?.field ?? "status") === "urgency"
        ? [...URGENCIES, NONE_GROUP]
        : [...ITEM_STATUSES];
  const present = new Set([
    ...items.map((i) => groupValueFor(i, grouping, now)),
    ...fullKnown,
  ]);
  const columns = orderedGroups(grouping, present, groupOrder);

  async function drop(col: string) {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const card = items.find((i) => i.id === id);
    if (!card || groupValueFor(card, grouping, now) === col) return;
    const patch = boardDropPatch(grouping, col);
    if (!patch) return;
    const prev = items;
    setItems((cs) => cs.map((c) => (c.id === id ? moveCard(c, grouping, col) : c)));
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setItems(prev); // revert on failure; the server stays canonical
    }
  }

  return (
    <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const colItems = items.filter((i) => groupValueFor(i, grouping, now) === col);
        return (
          <div
            key={col}
            onDragOver={(e) => {
              e.preventDefault();
              if (overCol !== col) setOverCol(col);
            }}
            onDrop={(e) => {
              e.preventDefault();
              void drop(col);
            }}
            className={`flex w-60 shrink-0 flex-col rounded-lg border bg-neutral-900/40 ${
              overCol === col && dragId ? "border-[var(--accent)]" : "border-neutral-800"
            }`}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              <span className="truncate">{col}</span>
              <span className="text-neutral-600">{colItems.length}</span>
            </div>
            <ul className="flex min-h-12 flex-col gap-1.5 p-2">
              {colItems.map((item) => (
                <li
                  key={item.id}
                  draggable
                  onDragStart={() => setDragId(item.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverCol(null);
                  }}
                  className={dragId === item.id ? "opacity-40" : ""}
                >
                  <Link
                    href={`/items/${item.id}`}
                    // Suppress the anchor's native drag so the <li>'s drag wins;
                    // a plain click still navigates to the item.
                    draggable={false}
                    className={`block cursor-grab rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm hover:border-neutral-700 active:cursor-grabbing ${
                      item.title ? "text-neutral-200" : "text-neutral-500"
                    } ${item.status === "done" ? "line-through opacity-60" : ""}`}
                  >
                    <span className="block truncate">{item.title || "Untitled"}</span>
                    {item.dateLabel && (
                      <span className="mt-0.5 block text-xs text-neutral-600">
                        {item.dateLabel}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
