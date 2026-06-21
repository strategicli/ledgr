// "+ Task" on the Related panel (ADR-055): add a task already associated with
// this item — now via the shared AddTaskCard (Tyler, 2026-06-21), so adding a
// task from a note/project/person uses the same card as everywhere else, with
// the host pre-selected as the destination (auto-association). The user can
// still switch the destination to Inbox or another project.
"use client";

import { useState } from "react";
import AddTaskCard from "@/components/tasks/AddTaskCard";

export default function NewRelatedTask({
  hostId,
  hostLabel = "This item",
}: {
  hostId: string;
  hostLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="px-2 py-1">
        <AddTaskCard
          host={{ id: hostId, label: hostLabel, role: "related" }}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }
  return (
    <button
      onClick={() => setOpen(true)}
      className="rounded px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-800 hover:text-neutral-300"
    >
      + Task
    </button>
  );
}
