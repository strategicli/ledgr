// The glyph a type-aware @-mention wears (type-aware mentions). One definition
// shared by every surface that draws a mention — the server print/share render
// (markdown-render.ts), the in-editor chip (the mention NodeView), and the
// @-suggestion popup — so the icon a mention shows can never drift between them.
//
// The icon is the TARGET TYPE's own configured nav icon (types.icon), resolved
// through nav-icons.ts, NOT a hardcoded per-kind map — so a custom or re-iconed
// type carries through for free. The one exception is a task: its glyph is a
// status-aware checkbox (open vs. done), the one type whose mark varies by state
// (the decision).
import { navIconPaths } from "@/lib/nav-icons";

// Status-aware task checkboxes, hand-rolled to the 24x24 stroke convention the
// nav glyphs use (the "tasks" nav glyph is always-checked; these distinguish
// open from done so a task mention reflects its live completion).
const TASK_OPEN = '<rect x="4" y="4" width="16" height="16" rx="3"/>';
const TASK_DONE =
  '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>';

export type MentionGlyphInput = {
  type: string | null;
  icon: string | null;
  statusCategory?: string | null;
};

// The system task type key — the one type whose mention glyph is a status-aware
// checkbox (and the only one with an interactive done-toggle in the editor).
export const TASK_TYPE_KEY = "task";

export function isTaskMention(type: string | null | undefined): boolean {
  return type === TASK_TYPE_KEY;
}

// The inner SVG path-set for a mention's glyph: a status-aware checkbox for a
// task, otherwise the target type's configured nav icon (with nav-icons' own
// generic fallback for an unknown/unset key).
export function mentionGlyphPaths(input: MentionGlyphInput): string {
  if (isTaskMention(input.type)) {
    return input.statusCategory === "done" ? TASK_DONE : TASK_OPEN;
  }
  return navIconPaths(input.icon ?? "");
}

// A standalone <svg> string carrying the glyph, sized in em so it tracks the
// surrounding text. The `mention-icon` class is the styling hook (sizing,
// vertical alignment) shared by the editor CSS and the print/share document CSS.
export function mentionGlyphSvg(input: MentionGlyphInput, size = 16): string {
  return `<svg class="mention-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mentionGlyphPaths(input)}</svg>`;
}
