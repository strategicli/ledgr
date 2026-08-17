// The record's full chronological timeline (Tyler, 2026-08-17): the Timeline
// card previews a window around today; "Showing N of M →" lands here, which
// lists EVERY meeting and milestone associated with the record in date order,
// grouped by month, with the open undated milestones ("Uncompleted") at the
// end. A milestone plots at its due date, or — undated but finished — at its
// completion stamp, same rule as the card (record-widgets.ts).
//
// Deliberately a light list, not the future everything-timeline (notes, task
// completions, findings on a vertical spine — explorations/
// project-review-timeline.md); this page is that idea's seed and its URL.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveComposition } from "@/lib/composition";
import { getItem } from "@/lib/items";
import { milestoneStates } from "@/lib/milestones";
import { resolveOwner } from "@/lib/owner";
import { getType } from "@/lib/types";
import { queryViewItems } from "@/lib/views";

export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

type Entry = { id: string; title: string; kind: "meeting" | "milestone"; date: Date; done: boolean };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const owner = await resolveOwner();
    if (!owner) return {};
    const record = await getItem(owner.id, id);
    return { title: `Timeline · ${record.title || "Untitled"}` };
  } catch {
    return {};
  }
}

export default async function RecordTimelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const owner = await resolveOwner();
  if (!owner) notFound();

  let record;
  try {
    record = await getItem(owner.id, id);
  } catch {
    notFound();
  }

  const [events, milestones, typeDef] = await Promise.all([
    queryViewItems(owner.id, { type: "event", relatedTo: id }, { field: "meetingAt", dir: "asc" }, 500),
    queryViewItems(owner.id, { type: "milestone", relatedTo: id }, { field: "dueDate", dir: "asc" }, 500),
    getType(record.type).catch(() => null),
  ]);
  const states = await milestoneStates(owner.id, milestones);
  // The no-date group's label follows the record's Timeline tool setting (its
  // own composition, else the type default), same as the card.
  const { composition } = resolveComposition(record.composition, typeDef?.defaultWidgets, record.type);
  const tlOptions = composition.widgets.find((w) => w.defId === "timeline")?.options;
  const undatedLabel =
    typeof tlOptions?.undatedLabel === "string" && tlOptions.undatedLabel
      ? tlOptions.undatedLabel
      : "Upcoming";

  const entries: Entry[] = [
    ...events.flatMap((e): Entry[] => {
      const date = e.meetingAt ?? e.scheduledDate ?? e.dueDate;
      return date ? [{ id: e.id, title: e.title, kind: "meeting", date, done: false }] : [];
    }),
    ...milestones.flatMap((m): Entry[] => {
      const s = states.get(m.id);
      const date = m.dueDate ?? s?.completedAt ?? null;
      return date ? [{ id: m.id, title: m.title, kind: "milestone", date, done: s?.done ?? false }] : [];
    }),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const undated = milestones
    .filter((m) => {
      const s = states.get(m.id);
      return !m.dueDate && !(s?.done && s.completedAt);
    })
    .map((m) => ({ id: m.id, title: m.title }));

  // Group by UTC month for scannable section headers.
  const months: { label: string; rows: Entry[] }[] = [];
  for (const e of entries) {
    const label = monthFmt.format(e.date);
    const last = months[months.length - 1];
    if (last && last.label === label) last.rows.push(e);
    else months.push({ label, rows: [e] });
  }

  const total = entries.length + undated.length;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-2 pb-24 pt-4 sm:px-8 md:px-12">
        <nav className="mb-1 text-xs text-neutral-500">
          <Link href={`/items/${id}`} className="hover:text-neutral-300">
            {record.title || "Untitled"}
          </Link>
          <span className="px-1.5 text-neutral-700">/</span>
          <span className="text-neutral-400">Timeline</span>
        </nav>
        <h1 className="mb-4 text-lg font-medium text-neutral-100">
          Timeline
          <span className="ml-2 text-sm font-normal text-neutral-500">{total}</span>
        </h1>

        {total === 0 ? (
          <p className="mt-6 px-2 text-sm text-neutral-600">No meetings or milestones yet.</p>
        ) : (
          <>
            {months.map((month) => (
              <section key={month.label} className="mb-4">
                <h2 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{month.label}</h2>
                <ul className="flex flex-col">
                  {month.rows.map((e) => (
                    <li
                      key={`${e.kind}-${e.id}`}
                      className="flex items-center gap-2 border-b border-neutral-900 py-2 last:border-0"
                    >
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${e.kind === "milestone" ? "bg-amber-950/50 text-amber-300" : "bg-sky-950/50 text-sky-300"}`}>
                        {e.kind}
                      </span>
                      <Link
                        href={`/items/${e.id}`}
                        className={`min-w-0 flex-1 truncate text-sm hover:text-neutral-100 ${e.done ? "text-neutral-500 line-through" : "text-neutral-200"}`}
                      >
                        {e.title || "Untitled"}
                      </Link>
                      <span className="shrink-0 text-xs text-neutral-500">{dateFmt.format(e.date)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {undated.length > 0 && (
              <section className="mb-4">
                <h2 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">{undatedLabel}</h2>
                <ul className="flex flex-col">
                  {undated.map((u) => (
                    <li key={u.id} className="flex items-center gap-2 border-b border-neutral-900 py-2 last:border-0">
                      <span className="shrink-0 rounded bg-amber-950/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">milestone</span>
                      <Link href={`/items/${u.id}`} className="min-w-0 flex-1 truncate text-sm text-neutral-200 hover:text-neutral-100">
                        {u.title || "Untitled"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
