// Subtasks section (slice 7, PRD §3.5): the item's child tree under the
// editor. A task with children reads as a mini-project — checklist rows
// with done-toggles and an "n of m done" rollup on the header and on every
// nested parent. Non-task children (a note filed under a project) list and
// nest but stay out of the rollup. Server component; the query is body-free
// and owner-scoped (src/lib/subtasks.ts).
import Link from "next/link";
import { listSubtree, type SubtaskNode } from "@/lib/subtasks";
import AddSubtask from "./AddSubtask";
import SubtaskCheckbox from "./SubtaskCheckbox";

// Due and scheduled dates are UTC-midnight calendar days (ADR-008); format in
// UTC so the shown day can't shift with the viewer's timezone.
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function ProgressBadge({ done, total }: { done: number; total: number }) {
  return (
    <span className="shrink-0 text-xs text-neutral-500">
      {done}/{total} done
    </span>
  );
}

function SubtaskRow({ node }: { node: SubtaskNode }) {
  const done = node.type === "task" && node.status === "done";
  return (
    <li>
      <div className="flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60">
        {node.type === "task" ? (
          <SubtaskCheckbox id={node.id} done={done} />
        ) : (
          <span className="w-4 shrink-0 text-center text-neutral-600">•</span>
        )}
        <Link
          href={`/items/${node.id}`}
          className={`min-w-0 flex-1 truncate text-sm ${
            node.title ? "text-neutral-200" : "text-neutral-500"
          } ${done ? "text-neutral-500 line-through" : ""}`}
        >
          {node.title || "Untitled"}
        </Link>
        {node.type !== "task" && (
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
            {node.type}
          </span>
        )}
        {node.progress && <ProgressBadge {...node.progress} />}
        {node.scheduledDate && (
          <span className="shrink-0 text-xs text-neutral-500">
            scheduled {dateFmt.format(node.scheduledDate)}
          </span>
        )}
        {node.dueDate && (
          <span className="shrink-0 text-xs text-neutral-500">
            due {dateFmt.format(node.dueDate)}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 border-l border-neutral-800 pl-3">
          {node.children.map((child) => (
            <SubtaskRow key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function Subtasks({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
}) {
  const { children, progress } = await listSubtree(ownerId, itemId);

  // No children yet: just the quiet capture affordance, no section chrome.
  if (children.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-12 pt-2">
        <AddSubtask parentId={itemId} />
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pt-4">
      <h2 className="flex items-baseline gap-2 border-b border-neutral-800 pb-1 text-sm font-semibold uppercase tracking-wide text-neutral-400">
        Subtasks
        {progress && (
          <span className="font-normal normal-case tracking-normal">
            <ProgressBadge {...progress} />
          </span>
        )}
      </h2>
      <ul className="mt-1">
        {children.map((node) => (
          <SubtaskRow key={node.id} node={node} />
        ))}
      </ul>
      <AddSubtask parentId={itemId} />
    </section>
  );
}
