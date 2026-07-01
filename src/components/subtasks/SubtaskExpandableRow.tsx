// A list row that owns a subtask "n/m" pill and, when the pill is toggled, an
// inline nested checklist below it — the list-surface counterpart to the
// canvas Subtasks section. Used by any flat list of tasks (the Tasks tabs, the
// generic type list, the view-renderer list/agenda layouts). The row's normal
// content is passed as `children` so each surface keeps its own columns; this
// only appends the pill and renders the expansion.
//
// The expansion lazy-loads the same body-free tree the canvas uses
// (GET /api/items/[id]/subtree) the first time it opens, so an idle list pays
// nothing. The row and its expansion are two sibling <li> elements returned
// together so one client component can own the shared open state.
"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import SubtaskCheckbox from "./SubtaskCheckbox";

// The subtree endpoint serializes dates to strings, so this mirrors SubtaskNode
// with string dates rather than reusing it (which types them as Date).
type TreeNode = {
  id: string;
  type: string;
  title: string;
  statusCategory: string;
  dueDate: string | null;
  scheduledDate: string | null;
  progress: { done: number; total: number } | null;
  children: TreeNode[];
};

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const fmt = (d: string | null) => (d ? dateFmt.format(new Date(d)) : "");

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniRow({ node }: { node: TreeNode }) {
  const done = node.type === "task" && node.statusCategory === "done";
  const scheduled = fmt(node.scheduledDate);
  const due = fmt(node.dueDate);
  return (
    <li>
      <div className="group/row flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-800/60">
        {node.type === "task" ? (
          <SubtaskCheckbox id={node.id} done={done} />
        ) : (
          <span className="w-4 shrink-0 text-center text-neutral-600">•</span>
        )}
        <Link
          href={`/items/${node.id}`}
          className={`min-w-0 flex-1 truncate text-sm ${
            node.title ? "text-neutral-300" : "text-neutral-500"
          } ${done ? "text-neutral-500 line-through" : ""}`}
        >
          {node.title || "Untitled"}
        </Link>
        {node.type !== "task" && (
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 text-xs text-neutral-400">
            {node.type}
          </span>
        )}
        {node.progress && (
          <span className="shrink-0 text-xs text-neutral-500">
            {node.progress.done}/{node.progress.total} done
          </span>
        )}
        {scheduled && (
          <span className="shrink-0 text-xs text-neutral-500">scheduled {scheduled}</span>
        )}
        {due && <span className="shrink-0 text-xs text-neutral-500">due {due}</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 border-l border-neutral-800 pl-3">
          {node.children.map((child) => (
            <MiniRow key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SubtaskExpandableRow({
  id,
  done,
  total,
  liClassName,
  children,
}: {
  id: string;
  done: number;
  total: number;
  // The <li> classes the host surface uses for a normal row, so the expandable
  // row is visually identical to its neighbors.
  liClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [nodes, setNodes] = useState<TreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && nodes === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/items/${id}/subtree`);
        if (res.ok) {
          const data = (await res.json()) as { children?: TreeNode[] };
          setNodes(data.children ?? []);
        }
      } catch {
        // offline/transient; a second click retries
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <>
      <li className={liClassName}>
        {children}
        <button
          type="button"
          onClick={() => void toggle()}
          aria-expanded={open}
          title={open ? "Hide subtasks" : "Show subtasks"}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
        >
          <Chevron open={open} />
          {done}/{total}
        </button>
      </li>
      {open && (
        <li>
          <ul className="ml-7 border-l border-neutral-800 pl-3">
            {loading && nodes === null ? (
              <li className="px-2 py-1 text-xs text-neutral-600">Loading…</li>
            ) : (nodes ?? []).length === 0 ? (
              <li className="px-2 py-1 text-xs text-neutral-600">No subtasks.</li>
            ) : (
              (nodes ?? []).map((node) => <MiniRow key={node.id} node={node} />)
            )}
          </ul>
        </li>
      )}
    </>
  );
}
