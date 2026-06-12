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

const TOP_STRIP: Record<string, CanvasField[]> = {
  task: ["status", "dueDate", "urgency"],
  meeting: ["meetingAt", "status"],
  note: ["status"],
  link: ["url", "status"],
  entity: ["kind", "status"],
};

// Custom types (§3.6) get the lowest common denominator until the Build
// surface lets them declare their own strip.
export function topStripFields(type: string): CanvasField[] {
  return TOP_STRIP[type] ?? ["status"];
}
