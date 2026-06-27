// The canonical body contract (ADR-037, ADR-040): items.body and revisions.body
// store { format, text } as jsonb. format is "markdown" by default; markdown-
// family formats (e.g. "chordpro") are allowed per content type. text is the
// source of truth — every render (print, export, FTS, and later docx/slides)
// derives from it, never the reverse.
//
// Pure shape helpers only: no markdown parsing here (that lives in
// markdown-render.ts, which is server-only), so this module is safe to import
// from both the client editor host and server code.

export const MARKDOWN_FORMAT = "markdown";

// Large-body threshold (ADR-125). At or above this many characters of markdown,
// a body is treated as a "document" rather than a "note": the canvas declines to
// mount the rich Tiptap editor (a single contenteditable tree of that many nodes
// freezes the tab) and opens read-only Preview by default with a raw-Source
// editor for edits. One tunable knob, shared by the client (which picks the body
// mode) and the server (which throttles revision snapshots for big bodies).
// 100K chars is ~16k words / ~40 pages: well past any real note, while leaving
// ~99% of items (measured p99 ≈ 96K) on the rich editor. Measured, not magic.
export const LARGE_BODY_THRESHOLD = 100_000;

// True once a body's markdown is large enough to skip the rich editor (ADR-125).
export function isLargeBody(text: string | null | undefined): boolean {
  return (text?.length ?? 0) >= LARGE_BODY_THRESHOLD;
}

export type ItemBody = { format: string; text: string };

export function makeMarkdownBody(text: string): ItemBody {
  return { format: MARKDOWN_FORMAT, text };
}

// True for a well-formed { format, text } body object.
export function isItemBody(body: unknown): body is ItemBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  const b = body as Record<string, unknown>;
  return typeof b.format === "string" && typeof b.text === "string";
}

// The markdown text of a body, or "" for an empty/absent/foreign body. Tolerant
// by design: a null body, a bare string, or a pre-cutover shape all degrade to
// a usable string rather than throwing, so every reader (FTS, mentions, print,
// export) has one safe entry point. After the M3 migration every row is the
// { format, text } shape; the degrade is a safety net, not a live path.
export function bodyMarkdown(body: unknown): string {
  if (isItemBody(body)) return body.text;
  if (typeof body === "string") return body;
  return "";
}
