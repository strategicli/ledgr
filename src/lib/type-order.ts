// Display order for type groupings: system types in seed order, anything
// added later alphabetical after them. Shared by the Work home and type
// list pages; the view engine (Phase 2) replaces this with per-view grouping.
export const TYPE_ORDER = ["task", "event", "note", "link", "person"];

export function compareTypeKeys(a: string, b: string): number {
  const ai = TYPE_ORDER.indexOf(a);
  const bi = TYPE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
