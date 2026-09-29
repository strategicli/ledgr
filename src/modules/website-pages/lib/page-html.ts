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
import { markdownToBlockHtml, markdownToText, type BlockRenderer } from "@/lib/markdown-render";
import { parseFencedBlocks, readBlockSettings, type FencedNode } from "@/lib/editor/fenced-blocks";
import type { ResolvedMention } from "@/lib/mentions";

// One published item as a site shows it: in a collection card, a menu entry, or
// its own subpage. The caller (the share routes) builds these from the page's
// publish list; everything here stays pure.
export type SiteItem = {
  id: string;
  slug: string;
  href: string;
  title: string;
  type: string;
  tags: string[];
  publishedAt: string;
  // Markdown, with attachment addresses already carrying the share token.
  bodyText: string;
};

// The site a page belongs to: its home page's name and body (the menu lives
// there), the home address, and everything published on it. Every page of a site
// renders with the same header, menu and footer (the "one chrome" rule).
export type SiteContext = {
  name: string;
  homeHref: string;
  homeMarkdown: string;
  items: SiteItem[];
};

export type WebPageOptions = {
  // Mentions resolved owner-scoped, and the public address each may link to.
  mentions?: Map<string, ResolvedMention>;
  publicLinks?: Map<string, string>;
  // Raw markup for the footer line ("Shared from …'s Ledgr"). The caller escapes.
  footerHtml?: string;
  site?: SiteContext;
  // Where this render sits in the site, for the menu's current-page mark.
  currentHref?: string;
  // A subpage's line under its title: date, and a way back.
  meta?: { publishedAt?: string; backHref?: string; backLabel?: string };
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

function markdownOf(children: FencedNode[]): string {
  return children
    .filter((c): c is Extract<FencedNode, { kind: "markdown" }> => c.kind === "markdown")
    .map((c) => c.text)
    .join("\n\n");
}

function cardsBlock(children: FencedNode[], renderMarkdown: (text: string) => string): string {
  // Cards are cut from the block's own markdown; a nested block inside cards is
  // not a card and keeps its place after them.
  const parts = markdownOf(children).split(/^(?=###[ \t])/m);
  const intro = /^###[ \t]/.test(parts[0] ?? "") ? "" : (parts.shift() ?? "");
  return (
    '<section class="lb lb-cards">' +
    (intro.trim() ? `<div class="lb-intro">${renderMarkdown(intro)}</div>` : "") +
    '<div class="lb-card-grid">' +
    parts.map((p) => `<article class="lb-card">${renderMarkdown(p)}</article>`).join("") +
    "</div></section>"
  );
}

// --- collections --------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// The first image in a body and a short plain-text excerpt, for a card.
export function summarize(bodyText: string): { image: string | null; excerpt: string } {
  const img = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(bodyText);
  const text = markdownToText(bodyText.replace(/!\[[^\]]*\]\([^)]*\)/g, " "));
  const excerpt = text.length > 170 ? `${text.slice(0, 170).replace(/\s+\S*$/, "")}…` : text;
  return { image: img ? img[1] : null, excerpt };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");

// A collection lists what the page PUBLISHES, narrowed by its settings:
//   title:  heading above the list        type:   an item type (key or label)
//   tag:    a tag name                    show:   "6", "6 newest", "3 oldest"
//   layout: grid (default) | list
// It never reaches past the publish list, which is the privacy rule.
export function selectCollection(items: SiteItem[], settings: Record<string, string>): SiteItem[] {
  let out = items;
  if (settings.type) out = out.filter((i) => norm(i.type) === norm(settings.type) || norm(i.type) === norm(settings.type).replace(/s$/, ""));
  if (settings.tag) out = out.filter((i) => i.tags.some((t) => norm(t) === norm(settings.tag)));
  const show = /^(\d+)?\s*(newest|oldest)?$/i.exec((settings.show ?? "").trim());
  const oldest = show?.[2]?.toLowerCase() === "oldest";
  out = [...out].sort((a, b) => (oldest ? a.publishedAt.localeCompare(b.publishedAt) : b.publishedAt.localeCompare(a.publishedAt)));
  const n = show?.[1] ? Number(show[1]) : 0;
  return n > 0 ? out.slice(0, n) : out;
}

function collectionBlock(children: FencedNode[], site: SiteContext | undefined, renderMarkdown: (t: string) => string): string {
  const { settings, rest } = readBlockSettings(markdownOf(children));
  const list = site ? selectCollection(site.items, settings) : [];
  const layout = settings.layout === "list" ? "list" : "grid";
  const cards = list
    .map((i) => {
      const { image, excerpt } = summarize(i.bodyText);
      return (
        `<a class="lb-item" href="${esc(i.href)}">` +
        (image && layout === "grid" ? `<span class="lb-item-art"><img src="${esc(image)}" alt=""></span>` : "") +
        `<span class="lb-item-date">${esc(formatDate(i.publishedAt))}</span>` +
        `<span class="lb-item-title">${esc(i.title)}</span>` +
        (excerpt ? `<span class="lb-item-excerpt">${esc(excerpt)}</span>` : "") +
        "</a>"
      );
    })
    .join("");
  return (
    `<section class="lb lb-collection lb-collection--${layout}">` +
    (settings.title ? `<h2 class="lb-collection-title">${esc(settings.title)}</h2>` : "") +
    (rest ? renderMarkdown(rest) : "") +
    (cards ? `<div class="lb-items">${cards}</div>` : '<p class="lb-empty">Nothing published here yet.</p>') +
    "</section>"
  );
}

// --- the site's chrome: header, menu, footer ----------------------------------

// The home page's `::: menu` block (a markdown list of links), rendered once and
// shown in the header of every page. Without one, the menu builds itself: Home,
// then every published item that is itself a Website Page (About, Contact…).
function menuLinks(site: SiteContext, publicLinks: Map<string, string>): { label: string; href: string }[] {
  const menu = findBlock(parseFencedBlocks(site.homeMarkdown), "menu");
  if (menu) {
    const html = markdownToBlockHtml(markdownOf(menu.children), { publicLinks, keepHeadings: true });
    return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
      href: m[1],
      label: m[2].replace(/<[^>]+>/g, ""),
    }));
  }
  return [
    { label: "Home", href: site.homeHref },
    ...site.items.filter((i) => i.type === "website-page").map((i) => ({ label: esc(i.title), href: i.href })),
  ];
}

function findBlock(nodes: FencedNode[], name: string): Extract<FencedNode, { kind: "block" }> | undefined {
  for (const n of nodes) {
    if (n.kind !== "block") continue;
    if (n.name === name) return n;
    const inner = findBlock(n.children, name);
    if (inner) return inner;
  }
  return undefined;
}

function siteHeader(site: SiteContext, publicLinks: Map<string, string>, current: string | undefined): string {
  const links = menuLinks(site, publicLinks);
  const nav = links
    .map((l) => `<a href="${l.href}"${l.href === current ? ' aria-current="page"' : ""}>${l.label}</a>`)
    .join("");
  // Two copies of the menu: inline on wide screens, behind a native disclosure on
  // phones. Closed <details> content can't be revealed by CSS, so one element
  // can't serve both; this keeps the page script-free.
  return (
    '<header class="site-head">' +
    `<a class="site-name" href="${esc(site.homeHref)}">${esc(site.name)}</a>` +
    (nav
      ? `<nav class="site-nav" aria-label="Site">${nav}</nav>` +
        `<details class="site-menu"><summary>Menu</summary><nav aria-label="Site">${nav}</nav></details>`
      : "") +
    "</header>"
  );
}

// Heading ids, so a menu entry like [Devotionals](#devotionals) can jump to a
// section of the home page.
function withHeadingIds(html: string): string {
  const used = new Set<string>();
  return html.replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const base = inner.replace(/<[^>]+>/g, "").toLowerCase().replace(/&[a-z#0-9]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

export function hasHero(markdown: string): boolean {
  return /^[ \t]{0,3}:{3,}[ \t]*hero\b/m.test(markdown);
}

export function renderWebPage(title: string, markdown: string, opts: WebPageOptions = {}): string {
  const publicLinks = opts.publicLinks ?? new Map<string, string>();
  const renderBlock: BlockRenderer = (block, { renderChildren, renderMarkdown }) => {
    if (block.name === "hero") return heroBlock(renderChildren());
    if (block.name === "cards") return cardsBlock(block.children, renderMarkdown);
    if (block.name === "collection") return collectionBlock(block.children, opts.site, renderMarkdown);
    // Chrome, not content: the menu renders in the header, on every page.
    if (block.name === "menu") return "";
    return undefined;
  };
  const body = withHeadingIds(
    markdownToBlockHtml(markdown, { mentions: opts.mentions, publicLinks, renderBlock, keepHeadings: true })
  );
  // A page with no hero still needs a headline: the item title stands in, with a
  // subpage's date and way back under it.
  const m = opts.meta;
  const metaLine =
    m && (m.publishedAt || m.backHref)
      ? '<p class="lb-meta">' +
        (m.backHref ? `<a href="${esc(m.backHref)}">← ${esc(m.backLabel ?? "Back")}</a>` : "") +
        (m.publishedAt ? `<span>${esc(formatDate(m.publishedAt))}</span>` : "") +
        "</p>"
      : "";
  const header = hasHero(markdown) ? metaLine : `<header class="lb-title">${metaLine}<h1>${esc(title)}</h1></header>`;
  const pageTitle = opts.site && opts.site.name !== title ? `${title} · ${opts.site.name}` : title;
  return (
    "<!doctype html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${esc(pageTitle)}</title><style>${STYLE}</style></head>` +
    "<body>" +
    (opts.site ? siteHeader(opts.site, publicLinks, opts.currentHref) : "") +
    `<main class="page">${header}${body}</main>` +
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
.site-head{max-width:1080px;margin:0 auto;padding:18px 20px 0;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.site-name{font-weight:750;font-size:18px;letter-spacing:-.01em;color:var(--fg);text-decoration:none;margin-right:auto}
.site-nav{display:none;gap:22px;font-size:15px}
.site-nav a,.site-menu nav a{color:var(--muted);text-decoration:none}
.site-nav a:hover,.site-menu nav a:hover{color:var(--fg)}
.site-nav a[aria-current],.site-menu nav a[aria-current]{color:var(--fg);font-weight:600}
.site-menu summary{cursor:pointer;font-size:15px;color:var(--muted);list-style:none;padding:6px 12px;border:1px solid var(--line);border-radius:999px}
.site-menu summary::-webkit-details-marker{display:none}
.site-menu[open] summary{color:var(--fg)}
.site-menu nav{display:grid;gap:10px;padding:14px 2px 4px;font-size:16px}
@media (min-width:760px){.site-nav{display:flex}.site-menu{display:none}}
.lb-meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;color:var(--muted);margin:0 0 10px}
.lb-meta a{color:var(--muted);text-decoration:none}.lb-meta a:hover{color:var(--fg)}
.lb-collection{display:grid;gap:18px}
.lb-collection-title{margin:0}
.lb-items{display:grid;gap:16px}
.lb-collection--grid .lb-items{grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr))}
.lb-item{display:grid;gap:6px;align-content:start;text-decoration:none;color:var(--fg);background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}
.lb-item:hover .lb-item-title{color:var(--lead)}
.lb-item:focus-visible{outline:2px solid var(--highlight);outline-offset:3px}
.lb-item-art img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:6px}
.lb-item-date{font-size:13px;color:var(--support);font-weight:600}
.lb-item-title{font-size:19px;font-weight:650;line-height:1.25;letter-spacing:-.01em}
.lb-item-excerpt{font-size:15px;color:var(--muted)}
.lb-collection--list .lb-item{background:none;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:14px 0}
.lb-empty{color:var(--muted)}
.page-foot{max-width:1080px;margin:0 auto;padding:18px 20px 28px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
`.replace(/\n/g, "");
