// Server-side markdown rendering (M3, ADR-040). Markdown is the canonical body
// (ADR-037); every server-side render derives from it here:
//
//  - markdownToHtml feeds the Save Offline / share print document and the
//    OneDrive export's HTML needs. Bespoke handling: ledgr://item/<id> links
//    render as flat mention spans (a ledgr:// URI means nothing on paper or a
//    public link), the color/highlight inline HTML the editor emits
//    (<span style>, <mark class>) passes through, and body headings shift down
//    one level so the document title keeps the <h1>.
//  - markdownToText feeds full-text search (items.body_text). It renders, then
//    strips tags, so the FTS document indexes mention labels and code text but
//    never URIs, color hexes, or markup.
//
// markdown-it is the one vetted markdown dependency (roadmap Phase M; a
// Principle-5 call): a single synchronous, battle-tested CommonMark/GFM package.
// It is never imported by a client component — print, export, and FTS are all
// server paths, so the editor bundle never pays for it.
import MarkdownIt from "markdown-it";
import { MENTION_URI_PREFIX } from "@/lib/editor/mention-markdown";

// html:true passes raw inline HTML through, which is required: the editor
// encodes sermon colors/highlights as <span style>/<mark class> (colors.ts).
// Safe under Ledgr's model — a single trusted author rendering their own
// content (Save Offline is owner-only; a share link publishes the owner's own
// note, and there is no other user's data on the instance). Revisit with a
// sanitizer if Ledgr ever renders content authored by someone other than the
// viewer's owner.
const md = new MarkdownIt({
  html: true, // pass the editor's <span style>/<mark class> color HTML through
  linkify: false, // only explicit [text](url) links become anchors
  breaks: false, // a lone newline is a CommonMark soft break, not <br>
});

// One token-rewriting pass, run before rendering. Stateless (mutates tokens in
// place), so there's no cross-render state to leak.
md.core.ruler.push("ledgr_transforms", (state) => {
  for (const token of state.tokens) {
    // The document title owns <h1>, so a body "# Heading" renders <h2>; clamp
    // at <h6> (the deepest real heading tag). Matches the pre-cutover render.
    if (token.type === "heading_open" || token.type === "heading_close") {
      const level = Number(token.tag.slice(1)) || 1;
      token.tag = "h" + Math.min(level + 1, 6);
      continue;
    }
    // Mention links → <span class="mention">@Title</span>. Links never nest in
    // markdown, so the first link_close after a mention link_open is its match.
    if (token.type === "inline" && token.children) {
      const kids = token.children;
      for (let j = 0; j < kids.length; j++) {
        if (kids[j].type !== "link_open") continue;
        const href = kids[j].attrGet("href") ?? "";
        if (!href.startsWith(MENTION_URI_PREFIX)) continue;
        kids[j].tag = "span";
        kids[j].attrs = [["class", "mention"]];
        for (let k = j + 1; k < kids.length; k++) {
          if (kids[k].type === "link_close") {
            kids[k].tag = "span";
            kids[k].attrs = null;
            break;
          }
        }
      }
    }
  }
});

// Markdown → HTML for the print/share document body and export. Empty in,
// empty out (the document shell renders the title and an empty body).
export function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  return md.render(markdown);
}

// Markdown → plain text for the FTS document. Render, then strip tags and decode
// the handful of entities the renderer emits, and collapse whitespace. Going
// through the renderer (not a raw regex strip of the markdown) is what drops
// ledgr:// URIs and color hexes while keeping mention labels and code text.
export function markdownToText(markdown: string): string {
  if (!markdown) return "";
  const text = md
    .render(markdown)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}
