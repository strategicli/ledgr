// The Save Offline / share document render (PRD §4.7, §4.12).
//
// A self-contained HTML page: inline CSS, no scripts beyond one print button,
// no app chrome, no /_next chunks. Self-containment is the point — this exact
// response is what the service worker pins into ledgr-pin-v1 and what a public
// share link serves from the CDN, so it must render with nothing else loaded,
// and its @media print rules make the browser's print-to-PDF the PDF leg. Dark
// on screen (stage-friendly, app-consistent), black-on-white in print.
//
// The body is canonical markdown (ADR-037/ADR-040); markdownToHtml turns it
// into the body markup (mentions as flat names, color HTML preserved, headings
// shifted under the title's <h1>). This module owns only the document shell and
// its styles.
import { BLOCKNOTE_COLORS } from "@/lib/colors";
import { bodyMarkdown, isItemBody } from "@/lib/body";
import { CHART_CSS } from "@/lib/chordpro/chart-css";
import { chordProToHtml } from "@/lib/chordpro/render";
import { CHORDPRO_FORMAT } from "@/lib/chordpro/types";
import { markdownToHtml } from "@/lib/markdown-render";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The self-contained document shell, shared by Save Offline's print route
// (slice 18) and public share links (slice 31). Inline CSS, no /_next chunks,
// no hydration; dark on screen (stage-friendly, app-consistent),
// black-on-white under @media print so the browser's print-to-PDF is the PDF
// leg. Because it carries its own styles it renders identically when pinned
// offline or served from a public CDN with no app context. The hl-* rules
// mirror the highlight colors the body markup carries inline.
const HL_CSS = Object.entries(BLOCKNOTE_COLORS)
  .map(
    ([name, c]) =>
      `mark.hl-${name}{background-color:${c.background};color:#1a1a1a}`
  )
  .join("\n");

const DOC_CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#0a0a0a;color:#e5e5e5;font:17px/1.65 Georgia,'Times New Roman',serif;
  max-width:46rem;margin:0 auto;padding:3rem 1.5rem 6rem}
h1{font-size:1.9rem;line-height:1.25;margin-bottom:1.5rem}
h2,h3,h4,h5,h6{margin:1.6em 0 .5em;line-height:1.3}
h2{font-size:1.45rem}h3{font-size:1.2rem}h4{font-size:1.05rem}
p,ul,ol,blockquote,figure,table,pre{margin-bottom:.85em}
ul,ol{padding-left:1.5em}
li>ul,li>ol{margin-bottom:0}
ul.contains-task-list{list-style:none;padding-left:.2em}
ul.contains-task-list li{margin-bottom:.2em}
li.task-list-item input{margin-right:.2em}
blockquote{border-left:3px solid #525252;padding-left:1em;color:#a3a3a3}
pre{background:#171717;border:1px solid #262626;border-radius:6px;
  padding:.75em 1em;overflow-x:auto;font-size:.85em}
code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
p code,li code{background:#171717;border-radius:3px;padding:.1em .3em}
a{color:#7cb3ff}
.mention{color:#7cb3ff;font-weight:600}
hr{border:none;border-top:1px solid #404040;margin:1.5em 0}
img{max-width:100%;height:auto;border-radius:4px}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #404040;padding:.35em .6em;vertical-align:top}
th{text-align:left;font-weight:600;background:#171717}
.doc-footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #262626;
  font:13px system-ui,sans-serif;color:#737373}
.print-bar{position:fixed;top:.75rem;right:.75rem}
.print-bar button{background:#262626;color:#e5e5e5;border:1px solid #404040;
  border-radius:6px;padding:.4rem .9rem;font:13px system-ui,sans-serif;cursor:pointer}
${HL_CSS}
@media print{
  :root{color-scheme:light}
  body{background:#fff;color:#111;max-width:none;padding:0;font-size:12pt}
  blockquote{border-color:#999;color:#444}
  pre{background:#f5f5f5;border-color:#ddd}
  p code,li code{background:#f5f5f5}
  a,.mention{color:#1a4d8f;text-decoration:none}
  hr{border-color:#ccc}
  td,th{border-color:#999}
  th{background:transparent}
  .doc-footer{display:none}
  .print-bar{display:none}
  h2,h3,h4{page-break-after:avoid}
}
${CHART_CSS}
`;

// Renders one item to a complete HTML page. `body` is the item's stored body
// ({ format, text }); `footerHtml` (already escaped/safe markup) appends a small
// note below the document — used by share links to mark the page read-only; the
// print-to-PDF leg drops it (@media print).
export function renderPrintDocument(
  title: string,
  body: unknown,
  opts: { footerHtml?: string } = {}
): string {
  const safeTitle = escapeHtml(title || "Untitled");
  const footer = opts.footerHtml ? `<div class="doc-footer">${opts.footerHtml}</div>` : "";
  // A chordpro body renders as a chord chart whose own header carries the title,
  // key/capo/tempo/time line — so the outer <h1> is suppressed for it. Every
  // other body stays on the markdown path under the title heading, unchanged.
  const isChordpro = isItemBody(body) && body.format === CHORDPRO_FORMAT;
  const heading = isChordpro ? "" : `<h1>${safeTitle}</h1>`;
  const bodyHtml = isChordpro
    ? chordProToHtml(bodyMarkdown(body))
    : markdownToHtml(bodyMarkdown(body));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${DOC_CSS}</style>
</head>
<body>
<div class="print-bar"><button onclick="window.print()">Print / PDF</button></div>
${heading}
${bodyHtml}
${footer}
</body>
</html>`;
}
