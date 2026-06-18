// One interactive row in the Related panel (ADR-055). The actionable
// related-items surface used to live only on the entity canvas (EmbeddedView);
// it now works on every item's detail page. This row owns the optimistic
// check-off and due-date edit for related tasks; structural edits
// (confirm/reject/un-relate) stay in RelationActions. mention/suggested state
// is computed server-side and passed in, so this stays a thin client leaf.
"use client";

import { useState } from "react";
import InlineTitle from "./InlineTitle";
import RelationActions from "./RelationActions";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export type RelatedRowItem = {
  id: string;
  type: string;
  title: string;
  status: string; // the status key (its label/color come from the type schema)
  statusCategory: string; // the bucket — done-ness keys off this (S2)
  dueDate: string | null; // ISO; due dates are UTC-midnight calendar days
  updatedAt: string; // ISO
};

export default function RelatedRow({
  hostId,
  item,
  suggested,
  mention,
  mentionOnly,
  removalRole,
}: {
  hostId: string;
  item: RelatedRowItem;
  suggested: boolean;
  mention: boolean;
  mentionOnly: boolean;
  // In a typed relation-field section (ADR-067), removal is scoped to the
  // field's role so it doesn't drop other links to the same item.
  removalRole?: string;
}) {
  const [done, setDone] = useState(item.statusCategory === "done");
  const [dueDate, setDueDate] = useState(item.dueDate);
  const [error, setError] = useState(false);
  const isTask = item.type === "task";

  // Optimistic: apply locally, PATCH, revert on failure. Single deliberate
  // gestures (a click, a date pick), not keystroke streams, so one request each.
  async function patch(body: Record<string, unknown>, revert: () => void) {
    setError(false);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      revert();
      setError(true);
    }
  }

  // The complete endpoint flips between the type's default done / not-started
  // status (S2), so this row needs no status schema.
  async function completeToggle(revert: () => void) {
    setError(false);
    try {
      const res = await fetch(`/api/items/${item.id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      revert();
      setError(true);
    }
  }
  function toggle() {
    const prev = done;
    setDone(!prev);
    void completeToggle(() => setDone(prev));
  }

  function changeDue(value: string) {
    const prev = dueDate;
    // Slice/compose the UTC date portion so a pick doesn't shift a day.
    const iso = value ? new Date(`${value}T00:00:00Z`).toISOString() : null;
    setDueDate(iso);
    void patch({ dueDate: iso }, () => setDueDate(prev));
  }

  return (
    <li
      className={`group flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60 ${
        suggested ? "opacity-60" : ""
      }`}
    >
      {isTask && (
        <input
          type="checkbox"
          checked={done}
          onChange={toggle}
          className="ledgr-check"
          aria-label={done ? "Mark open" : "Mark done"}
        />
      )}
      <InlineTitle
        id={item.id}
        title={item.title}
        done={done}
        className="flex-1"
        linkClassName={`text-sm ${
          item.title ? "text-neutral-200" : "text-neutral-500"
        }`}
      />
      {error && <span className="shrink-0 text-xs text-red-400">failed</span>}
      {mention && (
        <span
          title="Linked by an @-mention in the body"
          className="shrink-0 text-xs text-neutral-600"
        >
          @
        </span>
      )}
      {suggested && (
        <span className="shrink-0 rounded border border-dashed border-neutral-600 px-1.5 text-xs text-neutral-500">
          suggested
        </span>
      )}
      {!isTask && item.statusCategory !== "not_started" && (
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
          {item.status}
        </span>
      )}
      {isTask ? (
        <input
          type="date"
          value={dueDate ? dueDate.slice(0, 10) : ""}
          onChange={(e) => changeDue(e.target.value)}
          className="shrink-0 rounded border border-transparent bg-transparent text-xs text-neutral-500 [color-scheme:dark] hover:border-neutral-700 focus:border-neutral-600 focus:text-neutral-300 focus:outline-none"
          aria-label="Due date"
        />
      ) : (
        dueDate && (
          <span className="shrink-0 text-xs text-neutral-500">
            due {dateFmt.format(new Date(dueDate))}
          </span>
        )
      )}
      <span className="shrink-0 text-xs text-neutral-600">
        {dateFmt.format(new Date(item.updatedAt))}
      </span>
      <RelationActions
        itemId={hostId}
        otherId={item.id}
        suggested={suggested}
        removable={!mentionOnly}
        removalRole={removalRole}
      />
    </li>
  );
}
