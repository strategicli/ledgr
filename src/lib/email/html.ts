// Email body -> markdown conversion (slice 26, PRD §5.3; markdown bodies since
// ADR-040). HTML email converts imperfectly, which the PRD accepts; rather than
// pull in an HTML parser (rule 5), we reduce the body to plain text and emit it
// as markdown paragraphs. Fidelity is deliberately low; the original lands in
// the Inbox for review. Inline markdown punctuation in the text is escaped so a
// stray `*` or `[` from an email doesn't turn into formatting.

// Minimal entity decode for the handful that actually show up in mail text.
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

// Strip HTML to text: drop script/style, turn block-closing and <br> into
// newlines, remove remaining tags, decode entities, collapse runaway blank
// lines.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Escape the inline markdown/HTML punctuation that would otherwise be read as
// formatting. Same character set as the migration serializer's escapeText, so
// email text and editor text round-trip through the same rules.
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

// Build a markdown body from an email. Prefers the plain-text part; falls back
// to stripped HTML. Paragraphs split on blank lines; single newlines within a
// paragraph become spaces; empty in yields an empty string.
export function emailToMarkdown(
  bodyText: string | null,
  bodyHtml: string | null
): string {
  const text = (bodyText && bodyText.trim()) || (bodyHtml ? htmlToText(bodyHtml) : "");
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map((p) => escapeInline(p.replace(/\n/g, " ").trim()))
    .filter(Boolean)
    .join("\n\n");
}
