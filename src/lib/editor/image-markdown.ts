// Pure markdown <-> attrs glue for the editor's image node (the inline-image
// paste/drop feature, re-wired after the M3 markdown cutover, ADR-040). The
// Tiptap Image extension binds its renderMarkdown/parseMarkdown hooks to these
// so the encode/decode logic is node-testable (the same discipline colors.ts
// and mention-markdown.ts follow). Markdown is the source of truth (ADR-037):
// an image is the standard `![alt](src "title")`, which the server renderer
// (markdown-it) already turns into <img> for print/share/export.

export type ImageAttrs = { src: string; alt: string; title: string | null };

// A marked inline "image" token: { type:"image", href, title, text }.
export type ImageToken = { href?: string; text?: string; title?: string | null };

// Node attrs → markdown. Alt text escapes the brackets that would otherwise
// close the `![ ]` early; a title (rare) is quoted with escaped quotes.
export function imageToMarkdown(attrs: {
  src?: string | null;
  alt?: string | null;
  title?: string | null;
}): string {
  const src = (attrs.src ?? "").trim();
  const alt = (attrs.alt ?? "").replace(/[[\]]/g, "\\$&");
  const title = attrs.title
    ? ` "${String(attrs.title).replace(/"/g, '\\"')}"`
    : "";
  return `![${alt}](${src}${title})`;
}

// marked image token → node attrs.
export function imageAttrsFromToken(token: ImageToken): ImageAttrs {
  return {
    src: token.href ?? "",
    alt: token.text ?? "",
    title: token.title ?? null,
  };
}
