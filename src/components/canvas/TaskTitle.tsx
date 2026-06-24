// The task title row (ADR-108): a Todoist-style completion circle next to the
// title, colored by the task's priority, that marks the task done. Optimistic —
// the circle fills and the title strikes through instantly (one shared client
// state), then the /complete endpoint lands (recurrence-aware via toggleItemDone)
// and a refresh re-syncs. Replaces the separate rail "Status" row in checkbox
// mode. Multi-status (select) / none types pass no circle but still get the
// struck-through title when done.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { beginSave, endSave } from "@/lib/save-status";
import ItemEditor from "@/components/markdown-editor/ItemEditor";
import { priorityStyle, toPriority } from "@/lib/priority";

export default function TaskTitle({
  item,
  done: initialDone,
  priority,
  showCircle,
}: {
  item: { id: string; title: string; body: unknown };
  done: boolean;
  priority: number | null;
  // Checkbox-mode tasks get the interactive circle; select/none types don't
  // (their completion lives elsewhere) but still strike the title when done.
  showCircle: boolean;
}) {
  const router = useRouter();
  const [done, setDone] = useState(initialDone);
  // Re-adopt the server value after a refresh (adjust-during-render).
  const [prev, setPrev] = useState(initialDone);
  if (initialDone !== prev) {
    setPrev(initialDone);
    setDone(initialDone);
  }

  async function toggle() {
    const next = !done;
    setDone(next);
    beginSave();
    try {
      // The complete endpoint flips to the type's default done / not-started
      // status (recurrence-aware), so the circle needs no status schema.
      const res = await fetch(`/api/items/${item.id}/complete`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      endSave(true);
      router.refresh();
    } catch {
      setDone(!next);
      endSave(false);
    }
  }

  const p = toPriority(priority);
  const ps = p ? priorityStyle(p) : null;
  // Circle border = priority color (P6/none → neutral, matching "no priority").
  const ringColor = ps ? ps.ring : "border-neutral-600";
  const fillColor = ps ? ps.dot : "bg-neutral-600";

  return (
    <div className="flex items-start gap-3">
      {showCircle && (
        <button
          type="button"
          onClick={toggle}
          aria-label={done ? "Mark not done" : "Mark done"}
          aria-pressed={done}
          title={done ? "Completed — click to reopen" : "Mark complete"}
          className={`group/circle mt-[7px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors ${ringColor} ${
            done ? fillColor : "bg-transparent hover:bg-neutral-800/50"
          }`}
        >
          {/* Always rendered: a check that's hidden until hover (a faint hint in
              the priority color) and solid white once done. */}
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className={`h-3 w-3 transition-opacity ${
              done
                ? "text-white opacity-100"
                : `${ps ? ps.text : "text-neutral-400"} opacity-0 group-hover/circle:opacity-60`
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <ItemEditor item={item} slot="title" done={done} />
      </div>
    </div>
  );
}
