// Email body -> BlockNote conversion (slice 26, PRD §5.3). HTML email converts
// imperfectly, which the PRD accepts; rather than pull in an HTML parser (rule
// 5), we reduce the body to plain text and wrap it in paragraph blocks. The
// canonical body format is BlockNote JSON, so we hand-build the blocks the
// editor reads (no @blocknote import, same discipline as the markdown
// serializer). Fidelity is deliberately low; the original lands in the Inbox
// for review.

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

let counter = 0;
// BlockNote block ids only need to be unique within the doc; a per-call
// counter is deterministic (useful for verification) and collision-free.
function blockId(): string {
  return `mail-${++counter}`;
}

type Block = {
  id: string;
  type: "paragraph";
  props: Record<string, never>;
  content: { type: "text"; text: string; styles: Record<string, never> }[];
  children: never[];
};

function paragraph(text: string): Block {
  return {
    id: blockId(),
    type: "paragraph",
    props: {},
    content: text ? [{ type: "text", text, styles: {} }] : [],
    children: [],
  };
}

// Build a BlockNote document (array of paragraph blocks) from an email body.
// Prefers the plain-text part; falls back to stripped HTML. Paragraphs split
// on blank lines; single newlines within a paragraph become spaces.
export function emailToBlocks(
  bodyText: string | null,
  bodyHtml: string | null
): Block[] {
  const text = (bodyText && bodyText.trim()) || (bodyHtml ? htmlToText(bodyHtml) : "");
  if (!text) return [paragraph("")];
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  return paras.length > 0 ? paras.map(paragraph) : [paragraph("")];
}

// Test seam: reset the id counter so a verification run is reproducible.
export function _resetBlockIdsForTests(): void {
  counter = 0;
}
