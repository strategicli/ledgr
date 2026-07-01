// The all-projects card grid (Tyler, 2026-07-01): the main Projects list renders
// as cards, not a plain list. Each card shows the project title, its status
// chip, a progress bar (weighted points), its people, and collection counts —
// an at-a-glance dashboard of everything in flight. 3-up on the full page,
// 2-up when narrower, 1 on mobile. A server component; the whole card links to
// the project.
//
// Selection/bulk-select is deliberately off here (a gallery layout, like the
// board/calendar exceptions in CLAUDE.md); the plain list lens still has it.
import Link from "next/link";
import { progressPct } from "@/lib/project-progress";
import type { ProjectCard } from "@/lib/project-cards";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function CountBits({ counts }: { counts: ProjectCard["counts"] }) {
  const bits: string[] = [];
  if (counts.tasks) bits.push(`${counts.tasks} task${counts.tasks === 1 ? "" : "s"}`);
  if (counts.milestones) bits.push(`${counts.milestones} milestone${counts.milestones === 1 ? "" : "s"}`);
  if (counts.meetings) bits.push(`${counts.meetings} meeting${counts.meetings === 1 ? "" : "s"}`);
  if (bits.length === 0) return <span className="text-neutral-600">Empty</span>;
  return <span>{bits.join(" · ")}</span>;
}

function Card({ card }: { card: ProjectCard }) {
  const pct = progressPct(card.progress);
  const shown = card.people.slice(0, 5);
  const extra = card.people.length - shown.length;
  return (
    <Link
      href={`/items/${card.id}`}
      className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/70"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 break-words font-medium text-neutral-100">
          {card.title || "Untitled project"}
        </h3>
        {card.status && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-800 px-2 py-0.5 text-xs text-neutral-300">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: card.status.color }} />
            {card.status.label}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <CountBits counts={card.counts} />
          {pct !== null && <span className="shrink-0 text-neutral-400">{pct}%</span>}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct ?? 0}%` }} />
        </div>
      </div>

      {card.people.length > 0 && (
        <div className="flex items-center">
          {shown.map((p, i) => (
            <span
              key={p.id}
              title={p.title || "Untitled"}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-neutral-900 bg-neutral-700 text-[10px] font-medium text-neutral-200"
              style={{ marginLeft: i === 0 ? 0 : -6 }}
            >
              {initials(p.title)}
            </span>
          ))}
          {extra > 0 && <span className="ml-1.5 text-xs text-neutral-500">+{extra}</span>}
        </div>
      )}
    </Link>
  );
}

export default function ProjectCardGrid({ cards }: { cards: ProjectCard[] }) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </div>
  );
}
