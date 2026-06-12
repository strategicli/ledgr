// Which standard fields each type shows in the canvas top strip (PRD §4.13).
// Hardcoded per-type defaults for now; per-user/per-type configuration is a
// Build-surface feature, and this table is the seam it will replace. Fields
// not listed here surface read-only in the collapsed bottom Fields section.
export type CanvasField =
  | "status"
  | "dueDate"
  | "urgency"
  | "meetingAt"
  | "url"
  | "kind";

// Baked-in fields stay core to their type (ADR-018): status, due date, and
// urgency belong to tasks only. Other types surface nothing task-shaped;
// users add such fields later via custom properties, not built-ins.
const TOP_STRIP: Record<string, CanvasField[]> = {
  task: ["status", "dueDate", "urgency"],
  meeting: ["meetingAt"],
  note: [],
  link: ["url"],
  entity: ["kind"],
};

// Custom types (§3.6) get no built-in strip until the Build surface lets
// them declare their own.
export function topStripFields(type: string): CanvasField[] {
  return TOP_STRIP[type] ?? [];
}
