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

// The collapsed bottom "Fields" section (PRD §4.13): everything the top strip
// doesn't already show. Type/Created/Updated always appear; the rest only when
// set and not already in the strip (no field shows twice). Due/urgency stay
// task-only even on a legacy row of another type that carries them — the
// `task` guard, not just the strip de-dup, enforces ADR-018. Kept here beside
// topStripFields and pure, so the canvas's field layout is one testable place.
export type FooterField = { label: string; value: string };

type FooterItem = {
  type: string;
  dueDate: Date | null;
  urgency: string | null;
  meetingAt: Date | null;
  url: string | null;
  kind: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const tsFmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function footerFieldsFor(item: FooterItem): FooterField[] {
  const strip = topStripFields(item.type);
  const out: FooterField[] = [{ label: "Type", value: item.type }];
  const maybe = (name: CanvasField, label: string, value: string | null) => {
    if (value && !strip.includes(name)) out.push({ label, value });
  };
  // Task fields are task-only (ADR-018): never surfaced on another type, even
  // when legacy data set them.
  if (item.type === "task") {
    maybe("dueDate", "Due", item.dueDate ? tsFmt.format(item.dueDate) : null);
    maybe("urgency", "Urgency", item.urgency);
  }
  maybe("meetingAt", "When", item.meetingAt ? tsFmt.format(item.meetingAt) : null);
  maybe("url", "URL", item.url);
  maybe("kind", "Kind", item.kind);
  out.push({ label: "Created", value: tsFmt.format(item.createdAt) });
  out.push({ label: "Updated", value: tsFmt.format(item.updatedAt) });
  return out;
}
