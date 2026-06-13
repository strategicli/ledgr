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
