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

// The default character window the MCP read path (get_item) returns from a large
// body in a single call (ADR-126). A large body (isLargeBody) is paged: each
// read returns at most this many characters plus the offset to fetch the next
// window, so a 2.4M-char import can't flood the model's context in one read.
// Set to the large-body threshold so the boundaries line up: a body below the
// threshold returns whole and byte-identical (no marker, no behavior change),
// and the hard cap on any one read is exactly one "document's worth" (~40 pages
// / ~25k tokens) rather than the multi-megabyte tail. One tunable knob; a caller
// can request a smaller window (bodyLimit) but never a larger one.
export const BODY_WINDOW_CHARS = LARGE_BODY_THRESHOLD;

// A single character window over a markdown body, for paged reads (ADR-126).
export type BodyWindow = {
  text: string; // the bare source slice (no marker — the caller composes any prose)
  offset: number; // char offset the window starts at (clamped to [0, totalChars])
  returnedChars: number; // characters of source in this window (text.length)
  totalChars: number; // characters in the full body
  truncated: boolean; // true when the body extends past this window
  nextOffset: number | null; // offset to pass for the next window, or null at the end
};

// Slice a markdown body to one character window for paged reads (ADR-126). Pure
// shape: a substring plus the math to page through it, with NO markdown parsing
// (heading-aware sectioning would belong in markdown-render.ts, server-only, and
// would break this module's client/server portability). offset and limit are
// clamped to sane bounds, so a bad caller gets an empty or whole window rather
// than a throw. When the body fits in the window from offset 0, the returned
// slice equals the source and truncated is false (the small-body fast path).
export function windowBody(
  text: string,
  opts: { offset?: number; limit?: number } = {}
): BodyWindow {
  const totalChars = text.length;
  const limit = Math.max(1, Math.min(opts.limit ?? BODY_WINDOW_CHARS, BODY_WINDOW_CHARS));
  const offset = Math.max(0, Math.min(opts.offset ?? 0, totalChars));
  const end = Math.min(offset + limit, totalChars);
  const slice = text.slice(offset, end);
  const truncated = end < totalChars;
  return {
    text: slice,
    offset,
    returnedChars: slice.length,
    totalChars,
    truncated,
    nextOffset: truncated ? end : null,
  };
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
