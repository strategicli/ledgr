// Tab strip across the per-type list pages (PRD §4.2) plus the All-items
// browse (which keeps the Trash). The five system types keep their bespoke
// routes (/tasks etc.); custom types (Build surface, ADR-044) are appended,
// each linking to the generic focused list at /list/<key>, so a type you
// create shows up here without a hand-written page. Data-driven now; when the
// view engine fully owns these they become stored views (same seam as nav.ts).
import Link from "next/link";
import { getDb } from "@/db";
import { types } from "@/db/schema";

// Active tab is identified by a string: a system tab key, a type key, or "all".
export type ListTabKey = string;

// `person` is a system type but has no bespoke page; it rides the generic
// /list/<key> route like custom types do (its tab key is the type key, which
// the generic page sets as the active tab).
const SYSTEM_TABS = [
  { key: "tasks", label: "Tasks", href: "/tasks" },
  { key: "meetings", label: "Meetings", href: "/meetings" },
  { key: "notes", label: "Notes", href: "/notes" },
  { key: "links", label: "Links", href: "/links" },
  { key: "person", label: "People", href: "/list/person" },
];

export default async function ListTabs({ active }: { active: ListTabKey }) {
  const rows = await getDb()
    .select({ key: types.key, label: types.label, isSystem: types.isSystem })
    .from(types);
  const custom = rows
    .filter((r) => !r.isSystem)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((c) => ({ key: c.key, label: c.label, href: `/list/${c.key}` }));

  const tabs = [
    ...SYSTEM_TABS,
    ...custom,
    { key: "all", label: "All", href: "/items" },
  ];

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-neutral-800 pb-px">
      {tabs.map((tab) => (
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
