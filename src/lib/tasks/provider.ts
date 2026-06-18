// The `tasks` provider seam (T6, ADR-081). Ledgr owns tasks end to end (the
// native engine: recurrence ADR-076, scheduling ADR-077, focus ADR-078,
// reminders ADR-079, offline capture ADR-080), so **native is the default
// adapter** and needs no external sync. Todoist stays an OPTIONAL adapter
// (ADR-026) — opt in per instance with `TASKS_ADAPTER=todoist` (Tyler's stack).
// This is the same per-instance, behind-an-interface discipline as storage /
// calendar / mail; native default keeps the seam without removing Todoist.
//
// PURE (env only), so routes, /health, and verify scripts share one source of
// truth for "which adapter is active."

export type TasksAdapterId = "native" | "todoist";

// The active adapter. Todoist only when explicitly opted in AND actually
// configured (a token present); otherwise native — so an instance can't sit in
// a broken "todoist selected but unconfigured" state, it just falls back.
export function tasksAdapter(): TasksAdapterId {
  if (process.env.TASKS_ADAPTER === "todoist" && process.env.TODOIST_TOKEN) {
    return "todoist";
  }
  return "native";
}

// Whether the optional Todoist sync should run. Native (the default) owns tasks
// in-app with no outbound sync, so the Todoist sync endpoints no-op cleanly.
export function isTodoistAdapterActive(): boolean {
  return tasksAdapter() === "todoist";
}
