// Outline viewer generator (Papers module; v5). The read-only page the writer
// drafts from — shown in the Outline Preview (iframe) and opened by the clean-page
// button. Per section/paragraph: the writer's notes + the filed quotes. A quote
// shows ONLY its text; click it to roll down the Full/Short/Ibid footnote forms
// to copy. An auto Bibliography (every quoted source, MSM book form, sorted by
// surname) closes the page. One generator, so Preview and the opened page match.
// Deterministic, pure, node-testable.
import { bibliographyEntry, citationForms } from "@/lib/papers/citation";
import { quotesForParagraph, sectionLevelQuotes } from "@/lib/papers/outline";
import type { OutlineSection, QuoteEntry, Source } from "@/lib/papers/types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const emph = (s: string) => esc(s).replace(/\*([^*]+)\*/g, "<em>$1</em>");
const plain = (s: string) => s.replace(/\*/g, "");

// Notes as prose with light inline markdown (**bold**, *italic*): escape first,
// then emphasis, blank lines → paragraphs, single newlines → <br>. Avoids pulling
// the server-only markdown renderer into this client/iframe-rendered file.
function noteHtml(note: string): string {
  return note
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const html = esc(para)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
      return `<p class="note">${html}</p>`;
    })
    .join("");
}

function quoteHtml(q: QuoteEntry): string {
  const forms = citationForms(q.source, q.page);
  const text = q.text.trim() || "(no quote text)";
  const rows = ([["Full", forms.full], ["Short", forms.short], ["Ibid", forms.ibid]] as const)
    .map(
      ([label, form]) => `
        <div class="fn-row"><span class="fn-label">${label}</span><span class="fn-text">${emph(form)}</span><button class="fn-copy" data-copy="${esc(plain(form))}">Copy</button></div>`
    )
    .join("");
  return `<div class="quote"><div class="quote-text">&ldquo;${esc(text)}&rdquo;</div><div class="fn-popup"><div class="fn-row"><span class="fn-label">Quote</span><span class="fn-text">${esc(text)}</span><button class="fn-copy" data-copy="${esc(text)}">Copy</button></div>${rows}</div></div>`;
}

// Unique sources across all quotes, sorted by surname, as bibliography entries.
function bibliographyHtml(quotes: QuoteEntry[]): string {
  const seen = new Map<string, Source>();
  for (const q of quotes) {
    // Skip sources that aren't real entries yet (an empty or half-filled quote) —
    // they'd render as ". **. : , ." noise. A usable entry needs author + title.
    if (!q.source.author.trim() || !q.source.title.trim()) continue;
    const stamp = q.source.kind === "book" ? q.source.year : q.source.url;
    const key = `${q.source.authorLast}|${q.source.title}|${stamp}`;
    if (!seen.has(key)) seen.set(key, q.source);
  }
  if (seen.size === 0) return "";
  const entries = [...seen.values()]
    .sort((a, b) => a.authorLast.localeCompare(b.authorLast))
    .map((s) => `<div class="bib">${emph(bibliographyEntry(s))}</div>`)
    .join("");
  return `<section><h2 class="section-title">Bibliography</h2>${entries}</section>`;
}

export function buildOutlineHtml(opts: {
  title: string;
  subtitle?: string;
  sections: OutlineSection[];
  quotes: QuoteEntry[];
}): string {
  const { title, subtitle, sections, quotes } = opts;

  const body = sections
    .map((s) => {
      const sectionQuotes = sectionLevelQuotes(quotes, s.id).map(quoteHtml).join("");
      const cards = s.paragraphs
        .map((p) => {
          const titleHtml = p.title?.trim() ? `<div class="card-title">${esc(p.title.trim())}</div>` : "";
          const notes = p.note?.trim() ? noteHtml(p.note) : "";
          const qs = quotesForParagraph(quotes, p.id).map(quoteHtml).join("");
          if (!titleHtml && !notes && !qs) return "";
          return `<div class="card">${titleHtml}${notes}${qs}</div>`;
        })
        .join("");
      // Always show the section header so the outline reflects the structure.
      return `<section><h2 class="section-title">${esc(s.title.trim() || "Untitled section")}</h2>${sectionQuotes}${cards}</section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title || "Outline")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;background:#f5f3ef;color:#1a1a18;padding:2rem 1rem;line-height:1.6}
  .wrap{max-width:46rem;margin:0 auto}
  h1{font-size:1.5rem;font-weight:700;margin-bottom:.25rem}
  .subtitle{font-size:.85rem;color:#888;margin-bottom:2rem;font-family:sans-serif}
  .section-title{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9a8f7a;font-family:sans-serif;margin:1.75rem 0 .6rem}
  .card{background:#fff;border-radius:10px;border:1px solid #e0ddd6;padding:1.25rem;margin-bottom:.85rem}
  .card-title{font-size:1.1rem;font-weight:700;margin-bottom:.5rem}
  .note{font-size:.95rem;color:#333;margin-bottom:.6rem}
  .quote{background:#f9f8f5;border-radius:6px;padding:.7rem .9rem;margin-bottom:.5rem;border-left:3px solid #c8c4bb;cursor:pointer}
  .quote:hover{border-left-color:#888}
  .quote-text{font-size:.9rem;color:#333}
  .fn-popup{display:none;margin-top:.6rem;border-top:1px solid #e8e5de;padding-top:.6rem}
  .fn-popup.open{display:block}
  .fn-row{display:flex;align-items:flex-start;gap:.5rem;margin-bottom:.4rem}
  .fn-label{font-size:.65rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#aaa;font-family:sans-serif;min-width:46px;padding-top:3px;flex-shrink:0}
  .fn-text{font-size:.8rem;color:#444;font-family:sans-serif;flex:1}
  .fn-copy{font-size:.7rem;font-family:sans-serif;padding:2px 8px;border-radius:4px;border:1px solid #ccc;background:#fff;cursor:pointer;color:#555;flex-shrink:0}
  .fn-copy:hover{background:#2c2c2a;color:#fff;border-color:#2c2c2a}
  .fn-copy.copied{background:#4a7a4a;color:#fff;border-color:#4a7a4a}
  .bib{font-size:.85rem;color:#333;padding-left:1.5rem;text-indent:-1.5rem;margin-bottom:.5rem}
  .empty{color:#999;font-style:italic}
</style></head>
<body><div class="wrap">
<h1>${esc(title || "Untitled paper")}</h1>
${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ""}
${body || '<p class="empty">No outline yet. Add sections in Shape and file quotes in the Quote Bank.</p>'}
${bibliographyHtml(quotes)}
</div>
<script>
  document.querySelectorAll('.quote').forEach(function(q){
    q.addEventListener('click',function(e){
      if(e.target.classList.contains('fn-copy'))return;
      q.querySelector('.fn-popup').classList.toggle('open');
    });
  });
  document.querySelectorAll('.fn-copy').forEach(function(b){
    b.addEventListener('click',function(){
      navigator.clipboard.writeText(b.getAttribute('data-copy')||'').then(function(){
        var t=b.textContent;b.textContent='Copied';b.classList.add('copied');
        setTimeout(function(){b.textContent=t;b.classList.remove('copied')},1200);
      }).catch(function(){});
    });
  });
</script>
</body></html>`;
}
