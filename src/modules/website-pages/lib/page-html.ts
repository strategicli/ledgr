// The Website Page render (explorations/website-pages.md, slice 1): a Website
// Page item's markdown body as one self-contained web page, the way
// renderPrintDocument is one self-contained document. Inline CSS, no scripts,
// no /_next chunks, so it serves from the share route at CDN-cache cost.
//
// Layout comes from the body's fenced blocks (ADR-284). Each block guesses its
// parts from the plain markdown inside it, so an author writes ordinary
// markdown and never a list of settings:
//   hero     the first image becomes the art, a paragraph that is only a link
//            becomes a button, everything else is the headline and text
//   cards    each `###` heading starts a card; text before the first is an intro
//   callout  a tinted aside
// Any other block name renders as a plain section, so a newer body still reads
// on an older build.
//
// Slice 1 ships ONE design language (Modern) and ONE palette (Slate), light and
// dark by the viewer's system setting. The five languages, the fonts and the
// other palettes are slice 2, and replace STYLE without touching this markup.
// Pure: no DB, no React, so a verify script can render it directly.
import { markdownToBlockHtml, type BlockRenderer } from "@/lib/markdown-render";
import type { ResolvedMention } from "@/lib/mentions";

export type WebPageOptions = {
  // Mentions resolved owner-scoped, and the public address each may link to.
  mentions?: Map<string, ResolvedMention>;
  publicLinks?: Map<string, string>;
  // Raw markup for the footer line ("Shared from …'s Ledgr"). The caller escapes.
  footerHtml?: string;
};

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// A rendered paragraph holding nothing but one link or one image.
const LINK_ONLY_P = /<p>\s*(<a\b[^>]*>[\s\S]*?<\/a>)\s*<\/p>/g;
const IMAGE_ONLY_P = /<p>\s*(<img\b[^>]*>)\s*<\/p>/;

function heroBlock(inner: string): string {
  const img = IMAGE_ONLY_P.exec(inner);
  const text = (img ? inner.replace(img[0], "") : inner).replace(
    LINK_ONLY_P,
    (_m, a: string) => `<p class="lb-actions">${a.replace(/^<a\b/, '<a class="lb-btn"')}</p>`
  );
  return (
    `<section class="lb lb-hero${img ? " lb-hero--art" : ""}">` +
    `<div class="lb-hero-text">${text}</div>` +
    (img ? `<div class="lb-hero-art">${img[1]}</div>` : "") +
    "</section>"
  );
}

function cardsBlock(
  children: { kind: string; text?: string }[],
  renderMarkdown: (text: string) => string
): string {
  // Cards are cut from the block's own markdown; a nested block inside cards is
  // not a card and keeps its place after them.
  const text = children
    .filter((c) => c.kind === "markdown")
    .map((c) => c.text ?? "")
    .join("\n\n");
  const parts = text.split(/^(?=###[ \t])/m);
  const intro = /^###[ \t]/.test(parts[0] ?? "") ? "" : (parts.shift() ?? "");
  return (
    '<section class="lb lb-cards">' +
    (intro.trim() ? `<div class="lb-intro">${renderMarkdown(intro)}</div>` : "") +
    '<div class="lb-card-grid">' +
    parts.map((p) => `<article class="lb-card">${renderMarkdown(p)}</article>`).join("") +
    "</div></section>"
  );
}

const renderBlock: BlockRenderer = (block, { renderChildren, renderMarkdown }) => {
  if (block.name === "hero") return heroBlock(renderChildren());
  if (block.name === "cards") return cardsBlock(block.children, renderMarkdown);
  return undefined;
};

export function hasHero(markdown: string): boolean {
  return /^[ \t]{0,3}:{3,}[ \t]*hero\b/m.test(markdown);
}

export function renderWebPage(title: string, markdown: string, opts: WebPageOptions = {}): string {
  const body = markdownToBlockHtml(markdown, {
    mentions: opts.mentions,
    publicLinks: opts.publicLinks ?? new Map(),
    renderBlock,
    keepHeadings: true,
  });
  // A page with no hero still needs a headline: the item title stands in.
  const header = hasHero(markdown) ? "" : `<header class="lb-title"><h1>${esc(title)}</h1></header>`;
  return (
    "<!doctype html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${esc(title)}</title><style>${STYLE}</style></head>` +
    `<body><main class="page">${header}${body}</main>` +
    (opts.footerHtml ? `<footer class="page-foot">${opts.footerHtml}</footer>` : "") +
    "</body></html>"
  );
}

// Modern language, Slate palette (the sample-page values Tyler approved,
// 2026-09-28). Lead = buttons and links, support = labels and bands, highlight =
// small accents. Every color is a token so slice 2 swaps palettes by value.
const STYLE = `
:root{--bg:#f5f7fa;--surface:#fff;--fg:#151a22;--muted:#5a6473;--line:#dde2ea;--lead:#2f5fd0;--lead-fg:#fff;--support:#4f5f78;--band:#eceff5;--tint:#e8eefb;--highlight:#2fa9dc;
--font:"Public Sans","Helvetica Neue",Helvetica,Arial,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#10141a;--surface:#181d25;--fg:#edf1f6;--muted:#99a3b1;--line:#2a313c;--lead:#7ea2ff;--lead-fg:#0b1428;--support:#a7b4c8;--band:#1a1f28;--tint:#1c2742;--highlight:#6fd0f5;color-scheme:dark}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font);font-size:17px;line-height:1.6}
.page{max-width:1080px;margin:0 auto;padding:0 20px;display:grid;gap:44px;padding-block:32px 56px}
h1,h2,h3,h4{line-height:1.15;letter-spacing:-.02em;margin:0 0 .4em;text-wrap:balance}
h1{font-size:clamp(32px,4.6vw,46px);font-weight:750}
h2{font-size:clamp(26px,3.6vw,34px);font-weight:750}
h3{font-size:20px;font-weight:650;letter-spacing:-.01em}
p,ul,ol{margin:0 0 .9em}
a{color:var(--lead)}
img{max-width:100%;height:auto;display:block}
blockquote{margin:0;padding-left:18px;border-left:3px solid var(--line);color:var(--muted)}
.lb-title h1{font-size:clamp(34px,5vw,52px);font-weight:750;letter-spacing:-.03em;margin:0}
.lb-hero{display:grid;gap:24px;align-items:center}
.lb-hero-art{order:-1}
.lb-hero-art img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px}
.lb-hero h1,.lb-hero h2{font-size:clamp(34px,5.2vw,56px);letter-spacing:-.03em;line-height:1.04}
.lb-hero-text>p:not(.lb-actions){font-size:19px;color:var(--muted);max-width:46ch}
.lb-actions{margin-top:22px}
.lb-btn{display:inline-block;background:var(--lead);color:var(--lead-fg);text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px}
.lb-btn:focus-visible{outline:2px solid var(--highlight);outline-offset:3px}
@media (min-width:760px){.lb-hero--art{grid-template-columns:1.05fr 1fr}.lb-hero-art{order:0}.lb-hero-art img{aspect-ratio:16/11}}
.lb-cards{background:var(--band);border-radius:20px;padding:32px 24px;display:grid;gap:20px}
.lb-card-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}
.lb-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 18px rgba(0,0,0,.05)}
.lb-card p:last-child{margin-bottom:0}
.lb-card p{color:var(--muted);font-size:15.5px}
.lb-callout{background:var(--tint);border-radius:14px;padding:18px 22px}
.lb-callout>p:last-child{margin-bottom:0}
.lb-callout strong:first-child{display:inline-flex;align-items:center;gap:10px}
.lb-callout strong:first-child::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--highlight);flex:none}
.lb{min-width:0}
.mention{color:inherit;font-weight:600}
a.mention{color:var(--lead)}
pre{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px}
table{border-collapse:collapse;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px}
.page-foot{max-width:1080px;margin:0 auto;padding:18px 20px 28px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
`.replace(/\n/g, "");
