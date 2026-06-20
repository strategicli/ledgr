// "Toward 1.0" — two progress bars on the Changelog page, one per builder.
// Each tracks that builder's own v1.0 "done" line (Brandon: replace Notion;
// Tyler: replace Todoist + Apple Notes + creative/dev workspace). Source of
// truth is src/lib/v1-goals.ts. Server component, no client JS.
import { V1_GOALS, goalProgress, type Goal, type GoalSet } from "@/lib/v1-goals";

function StatusGlyph({ status }: { status: Goal["status"] }) {
  if (status === "done")
    return <span className="text-emerald-400" aria-label="done">✓</span>;
  if (status === "in_progress")
    return <span className="text-[var(--accent)]" aria-label="in progress">◐</span>;
  return <span className="text-neutral-600" aria-label="not started">○</span>;
}

function GoalCard({ set }: { set: GoalSet }) {
  const { pct, done, inProgress, total } = goalProgress(set.goals);
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-100">{set.person}&apos;s 1.0</h3>
        <span className="text-sm font-semibold tabular-nums text-[var(--accent)]">{pct}%</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">{set.bar}</p>

      {/* the bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs tabular-nums text-neutral-600">
        {done} done
        {inProgress > 0 ? ` · ${inProgress} in progress` : ""} · {total} total
      </p>

      {/* the checklist */}
      <ul className="mt-4 space-y-2">
        {set.goals.map((goal) => (
          <li key={goal.label} className="flex gap-2 text-sm">
            <span className="mt-px w-3.5 shrink-0 text-center">
              <StatusGlyph status={goal.status} />
            </span>
            <span className="min-w-0">
              <span
                className={
                  goal.status === "done" ? "text-neutral-300" : "text-neutral-200"
                }
              >
                {goal.label}
              </span>
              {goal.note && (
                <span className="block text-xs leading-snug text-neutral-600">{goal.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function V1Progress() {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-500">Toward 1.0</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        {V1_GOALS.map((set) => (
          <GoalCard key={set.person} set={set} />
        ))}
      </div>
    </section>
  );
}
