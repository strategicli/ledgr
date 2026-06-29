// Client list for the event canvas's rule-driven "Open tasks" (MeetingPrep).
// The rule (TaskPullControl) decides WHICH tasks; this owns how they're shown —
// a lightweight lens (filter + sort) over the already-resolved rows, so a long
// pull (the screenshot's 26 tasks) is scannable. Rows stay the actionable
// RelatedRow (check off + edit due in place). Default sort matches the server's
// prior order (due date, earliest first).
"use client";

import RelatedRow from "@/components/relations/RelatedRow";
import RelatedLensBar from "@/components/relations/RelatedLensBar";
import { RELATED_LENS_MIN_ROWS, useRelatedLens } from "@/lib/related-lens";

export type PrepTask = {
  id: string;
  type: string;
  title: string;
  status: string;
  statusCategory: string;
  dueDate: string | null; // ISO
  updatedAt: string; // ISO
};

export default function PrepTaskList({
  hostId,
  tasks,
}: {
  hostId: string;
  tasks: PrepTask[];
}) {
  const { sort, setSort, query, setQuery, visible } = useRelatedLens(hostId, tasks, {
    field: "dueDate",
    dir: "asc",
  });

  if (tasks.length === 0) {
    return <p className="px-1 pt-1 text-sm text-neutral-600">No open tasks match.</p>;
  }

  return (
    <div className="mt-1">
      {tasks.length >= RELATED_LENS_MIN_ROWS && (
        <RelatedLensBar
          sort={sort}
          onSortChange={setSort}
          query={query}
          onQueryChange={setQuery}
          visibleCount={visible.length}
          totalCount={tasks.length}
        />
      )}
      {visible.length === 0 ? (
        <p className="px-1 pt-1 text-sm text-neutral-600">No tasks match your filter.</p>
      ) : (
        <ul className="canvas-rows">
          {visible.map((t) => (
            <RelatedRow
              key={t.id}
              hostId={hostId}
              manageable={false}
              suggested={false}
              mention={false}
              mentionOnly={false}
              item={t}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
