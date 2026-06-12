// Pulpit Ready's document render (PRD §4.7): a self-contained HTML page —
// inline CSS, no scripts beyond one print button handler, no app chrome, no
// /_next chunks. Self-containment is the point: this exact response is what
// the pin protocol stores in the service worker's ledgr-pin-v1 cache, so it
// must render offline with nothing else cached, and its @media print rules
// make the browser's print-to-PDF the PDF leg. Dark on screen (stage
// friendly, app-consistent), black-on-white in print.
import { NextResponse } from "next/server";
import { BLOCKNOTE_COLORS } from "@/lib/colors";
import { ItemError, getItem } from "@/lib/items";
import { bodyToHtml, escapeHtml } from "@/lib/print-html";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

// Highlight backgrounds are Notion's light-palette pastels; they need dark
// text inside to stay readable on the dark screen render too.
const HL_CSS = Object.entries(BLOCKNOTE_COLORS)
  .map(
    ([name, c]) =>
      `mark.hl-${name}{background-color:${c.background};color:#1a1a1a}`
  )
  .join("\n");

const CSS = `
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
li.checkitem{list-style:none;margin-left:-1.5em}
.check{display:inline-block;width:1.5em}
blockquote{border-left:3px solid #525252;padding-left:1em;color:#a3a3a3}
pre{background:#171717;border:1px solid #262626;border-radius:6px;
  padding:.75em 1em;overflow-x:auto;font-size:.85em}
code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
p code,li code{background:#171717;border-radius:3px;padding:.1em .3em}
a{color:#7cb3ff}
.mention{color:#7cb3ff;font-weight:600}
hr{border:none;border-top:1px solid #404040;margin:1.5em 0}
img{max-width:100%;height:auto;border-radius:4px}
figcaption{font-size:.85em;color:#a3a3a3;font-style:italic;margin-top:.3em}
table{border-collapse:collapse;width:100%}
td{border:1px solid #404040;padding:.35em .6em;vertical-align:top}
.page-break{height:0}
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
  td{border-color:#999}
  .page-break{page-break-after:always}
  .print-bar{display:none}
  h2,h3,h4{page-break-after:avoid}
}
`;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const owner = await resolveOwner();
  if (!owner) return NextResponse.redirect(new URL("/sign-in", _req.url));

  const { id } = await ctx.params;
  let item;
  try {
    item = await getItem(owner.id, id);
  } catch (err) {
    if (err instanceof ItemError) {
      return new NextResponse("Not found", { status: 404 });
    }
    throw err;
  }
  if (item.deletedAt) return new NextResponse("Not found", { status: 404 });

  const title = item.title || "Untitled";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="print-bar"><button onclick="window.print()">Print / PDF</button></div>
<h1>${escapeHtml(title)}</h1>
${bodyToHtml(item.body)}
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Never cached by HTTP layers: the pin cache is the one deliberate
      // copy, and it must reflect the moment the user pinned.
      "Cache-Control": "no-store",
    },
  });
}
