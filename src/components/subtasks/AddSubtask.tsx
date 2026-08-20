// "+ Add subtask" → the full shared AddTaskCard, nested under this parent
// (Tyler, 2026-08-19): breaking a task down gets the same robust creation as
// any task — date/priority/tag/person chips, "/" to description, "@" links,
// the custom-property kebab, NL dates in the title — not the bare title box
// this used to be. Thin wrapper over InlineAddTask (which owns the optimistic
// provisional row + settle flow) so the Subtasks section's call sites keep
// their shape; the card posts with parentId, so the task nests under this one.
// The button stays bright, not faint (Tyler, 2026-08-14): this is the primary
// way to break a task down, so it reads as an offered action, not chrome.
"use client";

import InlineAddTask from "@/components/tasks/InlineAddTask";

export default function AddSubtask({ parentId }: { parentId: string }) {
  return (
    <InlineAddTask
      parentId={parentId}
      label="Add subtask"
      buttonClassName="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-ink hover:bg-surface-2"
    />
  );
}
