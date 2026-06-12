// Tab strip across the per-type list pages (PRD §4.2) plus the All-items
// browse (which keeps the Trash). These are the system View Definitions'
// stand-ins; when the view engine lands (Phase 2) this becomes a render of
// stored views, same seam pattern as nav.ts.
import Link from "next/link";

const TABS = [
  { key: "tasks", label: "Tasks", href: "/tasks" },
  { key: "meetings", label: "Meetings", href: "/meetings" },
  { key: "notes", label: "Notes", href: "/notes" },
  { key: "links", label: "Links", href: "/links" },
  { key: "entities", label: "Entities", href: "/entities" },
  { key: "all", label: "All", href: "/items" },
] as const;

export type ListTabKey = (typeof TABS)[number]["key"];

export default function ListTabs({ active }: { active: ListTabKey }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-neutral-800 pb-px">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`whitespace-nowrap rounded-t px-3 py-1.5 text-sm ${
            tab.key === active
              ? "border-b-2 border-neutral-200 font-medium text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
