// The Website Page render (explorations/website-pages.md): a Website Page's
// markdown body as one self-contained web page, the way renderPrintDocument is
// one self-contained document. Inline CSS, no scripts, so it serves from the
// share route at CDN-cache cost.
//
// Layout comes from the body's fenced blocks (ADR-284); the LOOK comes from the
// page's design settings (theme.ts), never from the markdown. Every block below
// reads the design tokens (`var(--h-w)`, `var(--card-bg)`, …), which is what
// lets any starter render in any language. Blocks guess their parts from plain
// markdown, so an author writes an ordinary note:
//   hero       text before the heading is the eyebrow, the heading is the
//              headline, paragraphs are the lede, link-only lines are buttons
//              (the first solid, the rest outlined), the first image is the art
//   cards      each `###` starts a card          columns   each `###` a column
//   collection published items (settings lines)  timeline  `- **When** What _detail_`
//   stats      `- **Label** value`                quotes    each `>` quote, `— Who` last
//   cta        heading, text, link-only buttons    callout   a tinted aside
//   embed      a YouTube/Vimeo link, then a caption
//   row        blocks side by side                 menu, footer: site chrome
// A short paragraph before a block's first `##` becomes its label. Any other
// block name renders as a plain section. Pure: no DB, no React.
import { markdownToBlockHtml, markdownToText, type BlockRenderer } from "@/lib/markdown-render";
import { parseFencedBlocks, readBlockSettings, type FencedNode } from "@/lib/editor/fenced-blocks";
import type { ResolvedMention } from "@/lib/mentions";
import { DEFAULT_DESIGN, FONTS, LANGUAGES, themeCss, type Design } from "@/modules/website-pages/lib/theme";
import { navIconPaths } from "@/lib/nav-icons";
import { embedFor } from "@/lib/embed";
import { ICON_ALIASES, ICON_CODE, ICON_SIZES, iconKey } from "@/lib/icon-codes";
export { ICON_ALIASES };

// One published item as a site shows it: in a collection card, a menu entry, or
// its own subpage. The caller (the share routes) builds these; everything here
// stays pure.
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

// The site a page belongs to: its home page's name and body (the menu and
// footer live there), the home address, and everything published on it. Every
// page of a site renders with the same header, menu, footer and design.
export type SiteContext = {
  name: string;
  homeHref: string;
  homeMarkdown: string;
  items: SiteItem[];
};

type NavLink = { href: string; title: string };

export type WebPageOptions = {
  mentions?: Map<string, ResolvedMention>;
  publicLinks?: Map<string, string>;
  // Raw markup for the footer's credit line. The caller escapes.
  footerHtml?: string;
  site?: SiteContext;
  design?: Design;
  // Where this render sits in the site, for the menu's current-page mark.
  currentHref?: string;
  // A subpage's framing: its label line, date, and neighbors in the site.
  meta?: { label?: string; publishedAt?: string; prev?: NavLink; next?: NavLink; more?: SiteItem[] };
};

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const LINK_RE = /<a\b[^>]*>[\s\S]*?<\/a>/g;
// A rendered paragraph holding nothing but links (one or several).
const LINKS_ONLY_P = /<p>\s*((?:<a\b[^>]*>[\s\S]*?<\/a>[\s,·|]*)+)<\/p>/g;
const IMAGE_ONLY_P = /<p>\s*(<img\b[^>]*>)\s*<\/p>/;

function markdownOf(children: FencedNode[]): string {
  return children
    .filter((c): c is Extract<FencedNode, { kind: "markdown" }> => c.kind === "markdown")
    .map((c) => c.text)
    .join("\n\n");
}

// Link-only paragraphs become a row of buttons: the first solid, the rest
// outlined. Everything else is returned untouched.
function takeButtons(html: string): { html: string; buttons: string } {
  const links: string[] = [];
  const rest = html.replace(LINKS_ONLY_P, (_m, inner: string) => {
    links.push(...(inner.match(LINK_RE) ?? []));
    return "";
  });
  const buttons = links
    .map((a, i) => a.replace(/^<a\b/, `<a class="lb-btn${i ? " lb-btn--ghost" : ""}"`))
    .join("");
  return { html: rest, buttons: buttons ? `<div class="lb-actions">${buttons}</div>` : "" };
}

// A short plain paragraph before the first heading is the block's eyebrow label.
function takeLabel(html: string): { html: string; label: string } {
  const m = /^\s*<p>([^<]{1,80})<\/p>\s*(?=<h[1-3]\b)/.exec(html);
  if (!m) return { html, label: "" };
  return { html: html.slice(m[0].length), label: `<div class="lb-label">${m[1]}</div>` };
}

// The standard section head: an optional label, then the block's `##` heading.
function takeHead(html: string, extraLabel = "", extraTitle = ""): { html: string; head: string } {
  // A head that is only a short line ("A bit about me") is a label on its own.
  const lone = /^\s*<p>([^<]{1,80})<\/p>\s*$/.exec(html);
  if (lone) return { html: "", head: `<div class="lb-head"><div class="lb-label">${lone[1]}</div></div>` };
  const lab = takeLabel(html);
  let rest = lab.html;
  let title = extraTitle ? `<h2>${esc(extraTitle)}</h2>` : "";
  const h = /^\s*(<h2\b[^>]*>[\s\S]*?<\/h2>)/.exec(rest);
  if (h) {
    title = h[1];
    rest = rest.slice(h[0].length);
  }
  const label = lab.label || (extraLabel ? `<div class="lb-label">${esc(extraLabel)}</div>` : "");
  return { html: rest, head: label || title ? `<div class="lb-head">${label}${title}</div>` : "" };
}

const section = (name: string, inner: string, extra = "") =>
  `<section class="lb lb-${name}${extra}"><div class="lb-in">${inner}</div></section>`;

// --- blocks ---------------------------------------------------------------

function heroBlock(inner: string): string {
  const img = IMAGE_ONLY_P.exec(inner);
  let html = img ? inner.replace(img[0], "") : inner;
  const lab = takeLabel(html);
  html = lab.html.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/, "<h1$1>$2</h1>");
  const { html: text, buttons } = takeButtons(html);
  const withLede = text.replace(/<p>/g, '<p class="lb-lede">');
  return (
    `<section class="lb-hero${img ? " lb-hero--art" : ""}"><div class="lb-hero-in"><div class="lb-hero-row">` +
    `<div class="lb-hero-text"><div class="lb-hero-txt-in">${lab.label}${withLede}${buttons}</div></div>` +
    (img ? `<div class="lb-hero-art">${img[1]}</div>` : "") +
    "</div></div></section>"
  );
}

// Split a block's markdown at each `###`: the text before the first is the
// block's head (label + `##`), each part after is one entry.
function splitAtH3(children: FencedNode[], render: (t: string) => string): { head: string; parts: string[] } {
  const parts = markdownOf(children).split(/^(?=###[ \t])/m);
  const lead = /^###[ \t]/.test(parts[0] ?? "") ? "" : (parts.shift() ?? "");
  return { head: lead.trim() ? render(lead) : "", parts: parts.map(render) };
}

// Alignment words on a block's fence line: `::: columns center`, `::: columns
// split` (first left, middle centered, last right), `::: cards center`.
function alignOf(args: string, allowed: string[]): string {
  const word = args.trim().toLowerCase().split(/\s+/).find((w) => allowed.includes(w));
  return word ? ` lb-align-${word}` : "";
}

function cardsBlock(children: FencedNode[], render: (t: string) => string, args = ""): string {
  const { head, parts } = splitAtH3(children, render);
  const h = takeHead(head);
  return section(
    "cards",
    h.head + h.html + `<div class="lb-grid${alignOf(args, ["center"])}">` + parts.map((p) => `<article class="lb-card">${p}</article>`).join("") + "</div>",
    " lb-band"
  );
}

function columnsBlock(children: FencedNode[], render: (t: string) => string, args = ""): string {
  const { head, parts } = splitAtH3(children, render);
  const h = takeHead(head);
  return section(
    "columns",
    h.head + h.html + `<div class="lb-cols${alignOf(args, ["center", "split", "left"])}">` + parts.map((p) => `<div class="lb-col"><span class="lb-dot"></span>${p}</div>`).join("") + "</div>"
  );
}

// List items as rows, with a leading **bold** as the row's label.
function listRows(html: string): { label: string; rest: string }[] {
  const items = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/^\s*<p>|<\/p>\s*$/g, "").trim());
  return items.map((li) => {
    const m = /^<strong>([\s\S]*?)<\/strong>\s*(?:[·:–—-]\s*)?([\s\S]*)$/.exec(li);
    return m ? { label: m[1], rest: m[2] } : { label: "", rest: li };
  });
}

function timelineBlock(inner: string): string {
  const h = takeHead(inner);
  const list = /<ul>[\s\S]*<\/ul>|<ol>[\s\S]*<\/ol>/.exec(h.html)?.[0] ?? "";
  const rows = listRows(list)
    .map(({ label, rest }) => {
      // An _italic_ tail is the row's detail line.
      const d = /^([\s\S]*?)\s*<em>([\s\S]*?)<\/em>\s*$/.exec(rest);
      const title = d ? d[1].replace(/[.,;:·–—-]\s*$/, "") : rest;
      return (
        `<div class="lb-tl-row"><div>${label ? `<span class="lb-tl-when">${label}</span>` : ""}</div>` +
        `<div class="lb-tl-body"><div class="lb-tl-title">${title}</div>${d ? `<div class="lb-tl-detail">${d[2]}</div>` : ""}</div></div>`
      );
    })
    .join("");
  return section("timeline", h.head + h.html.replace(list, "") + `<div class="lb-tl">${rows}</div>`);
}

function statsBlock(inner: string): string {
  const rows = listRows(inner)
    .map(({ label, rest }) => `<div><div class="lb-stat-label">${label}</div><div class="lb-stat-value">${rest}</div></div>`)
    .join("");
  return section("stats", `<div class="lb-stats-grid">${rows}</div>`);
}

const ATTRIBUTION = /^\s*(?:—|–|-{1,2})\s*/;

function quotesBlock(inner: string): string {
  const h = takeHead(inner);
  const figs = [...h.html.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)]
    .map((m) => {
      const ps = [...m[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => p[1]);
      const who = ps.length > 1 && ATTRIBUTION.test(ps[ps.length - 1]) ? ps.pop()! : "";
      return (
        `<figure class="lb-quote">${ps.map((p) => `<p>${p}</p>`).join("")}` +
        (who ? `<figcaption>${who.replace(ATTRIBUTION, "")}</figcaption>` : "") +
        "</figure>"
      );
    })
    .join("");
  return section("quotes", h.head + `<div class="lb-quote-grid">${figs}</div>`);
}

function ctaBlock(inner: string): string {
  const { html, buttons } = takeButtons(inner);
  return section("cta", `<div class="lb-cta-box"><div class="lb-cta-text">${html}</div>${buttons}</div>`);
}

function calloutBlock(inner: string): string {
  return section("callout", `<div class="lb-callout-box">${inner}</div>`);
}

export { embedFor };

function embedBlock(children: FencedNode[], render: (t: string) => string): string {
  const text = markdownOf(children);
  const m = /(?:<(https?:\/\/[^>\s]+)>|\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/\S+))/.exec(text);
  const url = m ? (m[1] ?? m[2] ?? m[3]) : "";
  const target = url ? embedFor(url) : null;
  if (!target) return section("embed", render(text));
  // The caption is everything but the line that carried the address.
  const caption = text.split("\n").filter((l) => !l.includes(url)).join("\n").trim();
  const cap = caption ? `<figcaption>${render(caption).replace(/^\s*<p>|<\/p>\s*$/g, "")}</figcaption>` : "";
  const frame =
    target.kind === "video"
      ? `<div class="lb-embed-frame"><iframe src="${esc(target.src)}" title="${esc(caption.split("\n")[0] || "Video")}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
      : `<a class="lb-linkcard" href="${esc(target.href)}"><span class="lb-label">${esc(target.host)}</span><span class="lb-linkcard-url">${esc(target.href)}</span></a>`;
  return section("embed", `<figure>${frame}${cap}</figure>`);
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
//   label, title  the section head               type    an item type (key or label)
//   tag           a tag name                      show    "6", "6 newest", "3 oldest"
//   layout        grid (default) | list
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

const capitalize = (s: string) => s.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const artOf = (image: string | null, alt = "") =>
  image === "placeholder" ? `<span class="lb-ph">${esc(alt)}</span>` : image ? `<img src="${esc(image)}" alt="${esc(alt)}">` : "";

// One published item as a grid card: picture, label line, title, excerpt.
export function itemCard(i: SiteItem): string {
  const { image, excerpt } = summarize(i.bodyText);
  const meta = [i.tags[0] ?? capitalize(i.type), formatDate(i.publishedAt)].filter(Boolean).join(" · ");
  return (
    `<a class="lb-card lb-item" href="${esc(i.href)}">` +
    (image ? `<span class="lb-item-art">${artOf(image)}</span>` : "") +
    `<span class="lb-label">${esc(meta)}</span><h3>${esc(i.title)}</h3>` +
    (excerpt ? `<p class="lb-item-excerpt">${esc(excerpt)}</p>` : "") +
    "</a>"
  );
}

// A collection shows its items one of four ways (`layout:`):
//   grid    cards with a picture (the default)     list    title, date, excerpt rows
//   hero    the first item as the page's opening section (a "featured" slot)
//   series  a numbered row read in order, oldest first unless `show` says otherwise
function collectionBlock(children: FencedNode[], site: SiteContext | undefined, render: (t: string) => string): string {
  const { settings, rest } = readBlockSettings(markdownOf(children));
  const layout = ["list", "hero", "series"].includes(settings.layout ?? "") ? settings.layout! : "grid";
  const sel = layout === "series" && !/newest|oldest/i.test(settings.show ?? "") ? { ...settings, show: `${settings.show ?? ""} oldest`.trim() } : settings;
  const list = site ? selectCollection(site.items, sel) : [];

  if (layout === "hero") {
    const i = list[0];
    if (!i) return section("collection", '<p class="lb-empty">Nothing published here yet.</p>');
    const { image, excerpt } = summarize(i.bodyText);
    const label = [settings.label ?? "Featured", formatDate(i.publishedAt), readingTime(i.bodyText)].filter(Boolean).join(" · ");
    return (
      `<section class="lb-hero${image ? " lb-hero--art" : ""}"><div class="lb-hero-in"><div class="lb-hero-row">` +
      `<div class="lb-hero-text"><div class="lb-hero-txt-in"><div class="lb-label">${esc(label)}</div><h1>${esc(i.title)}</h1>` +
      (excerpt ? `<p class="lb-lede">${esc(excerpt)}</p>` : "") +
      `<div class="lb-actions"><a class="lb-btn" href="${esc(i.href)}">${esc(settings.button ?? "Read it")}</a></div></div></div>` +
      (image ? `<div class="lb-hero-art">${artOf(image, i.title)}</div>` : "") +
      "</div></div></section>"
    );
  }

  const h = takeHead("", settings.label, settings.title);
  const intro = rest ? `<div class="lb-intro">${render(rest)}</div>` : "";
  let body: string;
  if (!list.length) body = '<p class="lb-empty">Nothing published here yet.</p>';
  else if (layout === "list") {
    body =
      '<div class="lb-rows">' +
      list
        .map((i) => {
          const { excerpt } = summarize(i.bodyText);
          return (
            `<a class="lb-row-item" href="${esc(i.href)}"><h3>${esc(i.title)}</h3>` +
            `<span class="lb-row-date">${esc(formatDate(i.publishedAt))}</span>` +
            (excerpt ? `<span class="lb-row-excerpt">${esc(excerpt)}</span>` : "") +
            "</a>"
          );
        })
        .join("") +
      "</div>";
  } else if (layout === "series") {
    body =
      '<div class="lb-series">' +
      list
        .map(
          (i, n) =>
            `<a class="lb-card lb-item lb-series-item" href="${esc(i.href)}"><span class="lb-series-n">${n + 1}</span>` +
            `<span class="lb-series-meta">${esc(i.tags.find((t) => norm(t) !== norm(settings.tag ?? "") && !/^featured$/i.test(t)) ?? formatDate(i.publishedAt))}</span><h3>${esc(i.title)}</h3></a>`
        )
        .join("") +
      "</div>";
  } else body = `<div class="lb-grid">${list.map(itemCard).join("")}</div>`;
  return section("collection", h.head + intro + body, layout === "list" ? "" : " lb-band");
}

// Every tag used by what the page publishes, with how many items carry it.
// `exclude:` drops housekeeping tags (featured, a series tag) from the list.
function topicsBlock(children: FencedNode[], site: SiteContext | undefined, render: (t: string) => string): string {
  const { settings, rest } = readBlockSettings(markdownOf(children));
  const skip = new Set((settings.exclude ?? "").split(",").map((t) => norm(t)).filter(Boolean));
  const counts = new Map<string, number>();
  for (const i of site?.items ?? []) for (const t of i.tags) if (!skip.has(norm(t))) counts.set(t, (counts.get(t) ?? 0) + 1);
  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => `<span class="lb-tag">${esc(capitalize(t))}<span class="lb-tag-n">${n}</span></span>`)
    .join("");
  const h = takeHead("", settings.label, settings.title ?? "Topics");
  return section("topics", h.head + `<div class="lb-tags">${chips || '<span class="lb-empty">No topics yet.</span>'}</div>` + (rest ? `<div class="lb-topics-note">${render(rest)}</div>` : ""));
}

// Minutes to read a body, at 220 words a minute, never less than one.
export function readingTime(bodyText: string): string {
  const words = markdownToText(bodyText).split(/\s+/).filter(Boolean).length;
  return words ? `${Math.max(1, Math.round(words / 220))} min read` : "";
}

// --- the site's chrome: header, menu, footer ----------------------------------

function findBlock(nodes: FencedNode[], name: string): Extract<FencedNode, { kind: "block" }> | undefined {
  for (const n of nodes) {
    if (n.kind !== "block") continue;
    if (n.name === name) return n;
    const inner = findBlock(n.children, name);
    if (inner) return inner;
  }
  return undefined;
}

// The home page's `::: menu` block (a markdown list of links), shown in the
// header of every page. Without one, the menu builds itself: Home, then every
// published item that is itself a Website Page (About, Contact…).
// Each list entry is one menu item: its link when it has one, else its text as a
// plain label (Tyler: if someone adds a line there, show it).
function menuLinks(site: SiteContext, publicLinks: Map<string, string>): { label: string; href: string | null }[] {
  const menu = findBlock(parseFencedBlocks(site.homeMarkdown), "menu");
  if (menu) {
    const html = markdownToBlockHtml(markdownOf(menu.children), { publicLinks, keepHeadings: true });
    return [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((m) => {
        const a = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);
        const label = (a ? a[2] : m[1]).replace(/<[^>]+>/g, "").trim();
        return { href: a ? a[1] : null, label };
      })
      .filter((l) => l.label);
  }
  return [
    { label: "Home", href: site.homeHref },
    ...site.items.filter((i) => i.type === "website-page").map((i) => ({ label: esc(i.title), href: i.href })),
  ];
}

function siteHeader(site: SiteContext, publicLinks: Map<string, string>, current: string | undefined): string {
  const nav = menuLinks(site, publicLinks)
    .map((l) =>
      l.href
        ? `<a href="${l.href}"${l.href === current ? ' aria-current="page"' : ""}>${l.label}</a>`
        : `<span>${l.label}</span>`
    )
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

// Heading ids, so a menu entry like [Writing](#writing) can jump to a section.
function withHeadingIds(html: string): string {
  const used = new Set<string>();
  return html.replace(/<h([1-3])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const base =
      inner.replace(/<[^>]+>/g, "").replace(/(^|\s):[a-z][a-z0-9-]{1,30}(?::(?:small|medium|large|xl|\d{1,3}))?:(?=\s|$)/g, "$1").toLowerCase().replace(/&[a-z#0-9]+;|['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

// Whether the page opens on a hero of its own (a `::: hero`, or a collection
// shown as one), in which case it needs no separate title header.
export function hasHero(markdown: string): boolean {
  return /^[ \t]{0,3}:{3,}[ \t]*hero\b/m.test(markdown) || /^[ \t]*layout:[ \t]*hero[ \t]*$/m.test(markdown);
}

// A subpage's opening paragraph, pulled out as its lede when more follows it.
function splitLede(markdown: string): { lede: string; rest: string } {
  const m = /^\s*([^\s#>*\-+!|:`<\d][^\n]*(?:\n(?!\s*\n)[^\n]*)*)\n\s*\n([\s\S]+)$/.exec(markdown);
  return m ? { lede: m[1], rest: m[2] } : { lede: "", rest: markdown };
}

// `![caption](placeholder)` draws the striped stand-in box the starters use, so a
// sample page looks finished before the owner has a photo; the caption says
// what picture belongs there.
function withPlaceholders(html: string): string {
  return html.replace(/<img src="placeholder" alt="([^"]*)"[^>]*>/g, '<span class="lb-ph" role="img" aria-label="$1">$1</span>');
}

// `:name:` draws one of Ledgr's own icons (src/lib/nav-icons.ts) in the page's
// colors. Only real icon names turn into icons, so `10:30:45` or an unknown
// `:word:` stays text, and code blocks are never touched.
export function withIcons(html: string): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<[^>]+>)/)
    .map((part) =>
      part.startsWith("<")
        ? part
        : part.replace(ICON_CODE, (m, pre: string, name: string, size?: string) => {
            const key = iconKey(name);
            if (!key) return m;
            const px = size && /^\d+$/.test(size) ? Math.min(256, Math.max(8, Number(size))) : 0;
            const dim = px ? `${px}px` : size ? ICON_SIZES[size] : "";
            const style = dim ? ` style="width:${dim};height:${dim}"` : "";
            const cls = dim ? "lb-icon lb-icon--sized" : "lb-icon";
            return `${pre}<svg class="${cls}"${style} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${navIconPaths(key)}</svg>`;
          })
    )
    .join("");
}

export function renderWebPage(title: string, markdown: string, opts: WebPageOptions = {}): string {
  const publicLinks = opts.publicLinks ?? new Map<string, string>();
  const design = opts.design ?? DEFAULT_DESIGN;
  const render = (text: string) => markdownToBlockHtml(text, { mentions: opts.mentions, publicLinks, keepHeadings: true });
  const renderBlock: BlockRenderer = (block, { renderChildren, renderMarkdown }) => {
    switch (block.name) {
      case "hero": return heroBlock(renderChildren());
      case "cards": return cardsBlock(block.children, renderMarkdown, block.args);
      case "columns": return columnsBlock(block.children, renderMarkdown, block.args);
      case "collection": return collectionBlock(block.children, opts.site, renderMarkdown);
      case "topics": return topicsBlock(block.children, opts.site, renderMarkdown);
      case "timeline": return timelineBlock(renderChildren());
      case "stats": return statsBlock(renderChildren());
      case "quotes": return quotesBlock(renderChildren());
      case "cta": return ctaBlock(renderChildren());
      case "callout": return calloutBlock(renderChildren());
      case "embed": return embedBlock(block.children, render);
      case "row": return `<div class="lb-row">${renderChildren()}</div>`;
      // Chrome, not content: rendered in the header and footer of every page.
      case "menu":
      case "footer":
        return "";
      default: return undefined;
    }
  };
  const m = opts.meta;
  const isSubpage = !!m && !hasHero(markdown);
  const { lede, rest } = isSubpage ? splitLede(markdown) : { lede: "", rest: markdown };
  let proseRuns = 0;
  const body = withPlaceholders(withHeadingIds(
    markdownToBlockHtml(rest, {
      mentions: opts.mentions,
      publicLinks,
      renderBlock,
      keepHeadings: true,
      // The first prose run gets the drop cap (in languages that have one),
      // wherever it falls after stats, an embed or other blocks.
      wrapTopRun: (html) => section("prose", html, proseRuns++ === 0 ? " lb-prose--first" : ""),
    })
  ));
  // A page with no hero still needs a headline: the item title stands in, with a
  // subpage's label, date and lede around it.
  const labelLine = [m?.label, m?.publishedAt ? formatDate(m.publishedAt) : "", isSubpage ? readingTime(markdown) : ""].filter(Boolean).join(" · ");
  const header = hasHero(markdown)
    ? ""
    : '<header class="lb-title"><div class="lb-title-in">' +
      (labelLine ? `<div class="lb-label">${esc(labelLine)}</div>` : "") +
      `<h1>${esc(title)}</h1>` +
      (lede ? `<p class="lb-lede">${render(lede).replace(/^\s*<p>|<\/p>\s*$/g, "")}</p>` : "") +
      "</div></header>";
  const pager =
    m && (m.prev || m.next)
      ? '<nav class="lb-pager" aria-label="More">' +
        (m.prev
          ? `<a href="${esc(m.prev.href)}"><span class="lb-label">← Previous</span><span class="lb-pager-title">${esc(m.prev.title)}</span></a>`
          : "<span></span>") +
        (m.next
          ? `<a class="lb-pager-next" href="${esc(m.next.href)}"><span class="lb-label">Next →</span><span class="lb-pager-title">${esc(m.next.title)}</span></a>`
          : "") +
        "</nav>"
      : "";
  // "Keep reading": a few other published items, sharing a tag when possible.
  const more = m?.more?.length
    ? section("keep", `<div class="lb-head"><h2>Keep reading</h2></div><div class="lb-grid">${m.more.map(itemCard).join("")}</div>`)
    : "";
  const footBlock = opts.site ? findBlock(parseFencedBlocks(opts.site.homeMarkdown), "footer") : undefined;
  const footLeft = footBlock ? render(markdownOf(footBlock.children)).replace(/^\s*<p>|<\/p>\s*$/g, "") : "";
  // The footer is the owner's: exactly the `::: footer` block, or nothing.
  // (footerHtml is kept for renders outside a site, such as previews.)
  const footer =
    footLeft || opts.footerHtml
      ? `<footer class="page-foot">${footLeft ? `<span>${footLeft}</span>` : ""}${opts.footerHtml ? `<span>${opts.footerHtml}</span>` : ""}</footer>`
      : "";
  // Icon codes draw everywhere on the page; the browser tab gets plain words.
  const plain = (t: string) => t.replace(ICON_CODE, "$1").replace(/\s{2,}/g, " ").trim();
  const pageTitle = plain(opts.site && opts.site.name !== title ? `${title} · ${opts.site.name}` : title);
  return (
    "<!doctype html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${esc(pageTitle)}</title><style>${fontFaces(design)}${themeCss(design)}${STYLE}</style></head>` +
    `<body><div class="site${isSubpage ? " site--sub" : ""}" data-language="${esc(design.language)}">` +
    withIcons(
      (opts.site ? siteHeader(opts.site, publicLinks, opts.currentHref) : "") +
        `<main class="page">${header}<div class="lb-article">${body}</div>${pager}${withPlaceholders(more)}</main>` +
        footer
    ) +
    "</div></body></html>"
  );
}

// Self-hosted faces for the page's one font (public/fonts/pages). Helvetica
// ships no file.
const FACE_FILES: Record<string, { family: string; file: string; weight: string }> = {
  public: { family: "Public Sans", file: "public-sans", weight: "300 900" },
  montserrat: { family: "Montserrat", file: "montserrat", weight: "400 900" },
  figtree: { family: "Figtree", file: "figtree", weight: "400 900" },
  serif: { family: "Source Serif 4", file: "source-serif-4", weight: "400 700" },
};
function fontFaces(design: Design): string {
  const key = FONTS[design.font] ? design.font : (LANGUAGES[design.language]?.font ?? "public");
  const f = FACE_FILES[key];
  if (!f) return "";
  return ["normal", "italic"]
    .map(
      (style) =>
        `@font-face{font-family:'${f.family}';font-style:${style};font-weight:${f.weight};font-display:swap;src:url(/fonts/pages/${f.file}-${style}.woff2) format('woff2')}`
    )
    .join("");
}

// The component stylesheet. Every value that differs between languages or
// palettes is a token from theme.ts; this only says where each one goes.
// Mirrors the Claude Design starters (project "Ledgr Design System").
const STYLE = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font);font-size:17px;line-height:1.6}
.site{container-type:inline-size;min-height:100vh}
a{color:inherit}a:hover{opacity:.85}
img{max-width:100%;height:auto;display:block}
h1,h2,h3{margin:0;font-weight:var(--h-w);letter-spacing:var(--h-track);text-transform:var(--h-case);line-height:var(--h-lh);text-wrap:balance}
h1{font-size:var(--h1)}h2{font-size:var(--h2)}h3{font-size:var(--h3);letter-spacing:calc(var(--h-track) * .5);line-height:1.2}
p{margin:0}
.lb-label{font-size:var(--label-size);font-weight:var(--label-w);letter-spacing:var(--label-track);text-transform:var(--label-case);color:var(--label-c);line-height:1.3}
.lb{padding:calc(var(--gap-y) / 2) var(--pad)}
.lb-in{max-width:var(--wide);margin:0 auto}
.lb-band{background:var(--band-bg)}
.lb-head{border-top:var(--sec-rule);padding-top:var(--sec-pt);margin-bottom:clamp(20px,3cqi,32px);display:flex;flex-direction:column;gap:10px}
.lb-btn{display:inline-flex;align-items:center;padding:var(--btn-p);border-radius:var(--btn-r);background:var(--lead);color:var(--on-lead);font-weight:var(--btn-w);font-size:var(--btn-size);letter-spacing:var(--btn-track);text-transform:var(--btn-case);text-decoration:none;line-height:1.2;border:0}
.lb-btn--ghost{background:transparent;color:inherit;border:1.5px solid currentColor}
.lb-btn:focus-visible,.lb-item:focus-visible,.lb-row-item:focus-visible{outline:2px solid var(--hl);outline-offset:3px}
.lb-actions{display:flex;flex-wrap:wrap;gap:12px}
.site-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 24px;padding:18px var(--pad);border-bottom:var(--nav-bd)}
.site-name{font-weight:var(--h-w);letter-spacing:calc(var(--h-track) * .5);text-transform:var(--h-case);font-size:18px;text-decoration:none}
.site-nav{display:none;flex-wrap:wrap;gap:8px 20px;font-size:15px;font-weight:600}
.site-nav a,.site-menu nav a,.site-nav span,.site-menu nav span{text-decoration:none;color:var(--muted)}
.site-nav a[aria-current],.site-menu nav a[aria-current]{color:var(--lead)}
.site-menu summary{cursor:pointer;font-size:15px;font-weight:600;list-style:none;padding:6px 14px;border:1px solid var(--line);border-radius:var(--btn-r)}
.site-menu summary::-webkit-details-marker{display:none}
.site-menu nav{display:grid;gap:10px;padding:14px 2px 4px;font-size:16px}
@container (min-width:720px){.site-nav{display:flex}.site-menu{display:none}}
.lb-hero{padding:var(--hero-outer-p)}
.lb-hero-in{background:var(--hero-bg);color:var(--hero-ink);border-radius:var(--hero-r);padding:var(--hero-p)}
.lb-hero-row{max-width:var(--hero-max);margin:0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:clamp(24px,4cqi,56px)}
.lb-hero-text{flex:1 1 var(--hero-txt-basis);min-width:0;padding:var(--hero-txt-p);text-align:var(--hero-align)}
.lb-hero-txt-in{max-width:var(--hero-txt-max);margin:var(--hero-txt-m)}
.lb-hero .lb-label{color:var(--hero-label)}
.lb-hero h1{margin-top:14px}
.lb-hero .lb-lede{margin-top:20px;color:var(--hero-muted)}
.lb-hero .lb-actions{margin-top:28px;justify-content:var(--hero-justify)}
.lb-hero .lb-btn{background:var(--hero-btn-bg);color:var(--hero-btn-ink)}
.lb-hero .lb-btn--ghost{background:transparent;color:inherit;border-color:var(--hero-btn2-bd)}
.lb-hero-art{flex:1 1 var(--hero-img-basis);order:var(--hero-img-order);height:var(--hero-img-h);border-radius:var(--hero-img-r);overflow:hidden;background:var(--ph-b)}
.lb-hero-art img,.lb-hero-art .lb-ph{width:100%;height:100%;object-fit:cover}
.lb-ph{display:flex;align-items:flex-end;min-height:100%;padding:10px 12px;background:repeating-linear-gradient(135deg,var(--ph-a) 0 1px,transparent 1px 11px) var(--ph-b);font:500 11px/1.3 ui-monospace,Menlo,monospace;color:var(--muted)}
.lb-item-art .lb-ph{aspect-ratio:16/9;border-radius:var(--img-r)}
.lb-card .lb-ph,.lb-prose .lb-ph{aspect-ratio:3/2;border-radius:var(--img-r)}
.lb-prose .lb-ph{aspect-ratio:16/10}
.lb-card img{border-radius:var(--img-r)}
.lb-lede{font-size:var(--lede-size);font-style:var(--lede-style);line-height:1.5;color:var(--muted);text-wrap:pretty}
.lb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:clamp(16px,2.4cqi,28px);align-items:start}
.lb-card{display:flex;flex-direction:column;gap:10px;background:var(--card-bg);border:var(--card-bd);border-top:var(--card-bt);border-radius:var(--r);padding:var(--card-p);box-shadow:var(--card-sh);min-width:0}
.lb-card p{color:var(--muted);font-size:15px;line-height:1.55}
.lb-item{text-decoration:none;color:inherit;gap:12px}
.lb-item-art img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--img-r)}
.lb-series{display:flex;gap:clamp(12px,2cqi,20px);overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:14px}
.lb-series-item{flex:0 0 min(64%,236px);scroll-snap-align:start;gap:8px}
.lb-series-n{font-size:var(--num-size);font-weight:var(--h-w);color:var(--hl);line-height:1;letter-spacing:var(--h-track)}
.lb-series-meta{font-size:14px;color:var(--muted)}
.lb-intro{max-width:600px;margin:-8px 0 20px;color:var(--muted);font-size:15px}
.lb-tags{display:flex;flex-wrap:wrap;gap:8px 14px}
.lb-tag{display:inline-flex;gap:8px;align-items:baseline;background:var(--tag-bg);border:var(--tag-bd);border-radius:var(--tag-r);padding:var(--tag-p);color:var(--tag-ink);font-size:var(--tag-size);font-weight:var(--tag-w);text-transform:var(--tag-case);letter-spacing:var(--tag-track);line-height:1.2}
.lb-tag-n{font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}
.lb-topics-note{margin-top:20px;font-size:15px;color:var(--muted)}
.lb-row>.lb-topics{flex:1 1 240px}
.lb-rows{display:grid}
.lb-row-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 20px;padding:18px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.lb-row-date{font-size:14px;color:var(--muted);white-space:nowrap}
.lb-row-excerpt{grid-column:1/-1;font-size:15px;color:var(--muted);line-height:1.5}
.lb-empty{color:var(--muted)}
.lb-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:clamp(24px,4cqi,48px)}
.lb-col{display:flex;flex-direction:column;gap:10px}
.lb-col p{color:var(--muted);font-size:15px;line-height:1.6}
.lb-dot{width:10px;height:10px;border-radius:var(--dot-r);background:var(--hl)}
.lb-icon{width:1.1em;height:1.1em;display:inline-block;vertical-align:-.18em;color:var(--lead)}
.lb-icon--sized{vertical-align:middle}
.lb-align-center .lb-col,.lb-align-center .lb-card{align-items:center;text-align:center}
.lb-align-split .lb-col:not(:first-child):not(:last-child){align-items:center;text-align:center}
.lb-align-split .lb-col:last-child:not(:first-child){align-items:flex-end;text-align:right}
.lb-in:has(>.lb-align-center)>.lb-head{align-items:center;text-align:center}
.lb-align-center h3>.lb-icon:first-child,.lb-align-split .lb-col:not(:first-child):not(:last-child) h3>.lb-icon:first-child{margin-inline:auto}
.lb-align-split .lb-col:last-child:not(:first-child) h3>.lb-icon:first-child{margin-left:auto;margin-right:0}
@container (max-width:619px){.lb-align-split .lb-col{align-items:flex-start!important;text-align:left!important}.lb-align-split .lb-col h3>.lb-icon:first-child{margin-left:0!important;margin-right:0!important}}
.lb-col:has(h3>.lb-icon:first-child) .lb-dot{display:none}
.lb-col h3>.lb-icon:first-child,.lb-card h3>.lb-icon:first-child{display:block;width:32px;height:32px;padding:6px;margin-bottom:12px;border-radius:var(--r);background:var(--lead-tint);color:var(--lead)}
.lb-tl-row{display:grid;grid-template-columns:var(--tl-cols);gap:6px 18px;padding:16px 0;border-bottom:1px solid var(--line)}
.lb-tl-when{display:inline-block;font-size:min(var(--tl-ys),15px);font-weight:var(--tl-yw);color:var(--tl-yc);background:var(--tl-ybg);padding:var(--tl-yp);border-radius:var(--tl-yr);letter-spacing:var(--tl-ytrack);line-height:1;white-space:nowrap}
.lb-tl-title{font-size:16px;font-weight:var(--h-w);text-transform:var(--h-case);letter-spacing:calc(var(--h-track) * .4);line-height:1.3}
.lb-tl-detail{font-size:14px;color:var(--muted);margin-top:3px}
.lb-stats .lb-in{max-width:min(var(--col),820px)}
.lb-stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:16px;padding:16px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.lb-stat-label{font-size:var(--label-size);font-weight:var(--label-w);letter-spacing:var(--label-track);text-transform:var(--label-case);color:var(--muted)}
.lb-stat-value{font-size:15px;font-weight:600;margin-top:4px}
.lb-quote-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:clamp(16px,3cqi,32px)}
.lb-quote,.lb-callout-box{margin:0;background:var(--co-bg);color:var(--co-ink);border-style:solid;border-width:var(--co-bw);border-color:var(--co-bc);border-radius:var(--co-r);padding:var(--co-p);text-align:var(--co-align)}
.lb-quote p{font-size:clamp(17px,2cqi,20px);font-weight:var(--co-w);font-style:var(--co-style);line-height:1.45;text-wrap:pretty}
.lb-quote p:first-child::before{content:"\\201C"}.lb-quote p:last-of-type::after{content:"\\201D"}
.lb-quote figcaption{margin-top:14px;font-size:var(--label-size);font-weight:var(--label-w);letter-spacing:var(--label-track);text-transform:var(--label-case);opacity:.8;line-height:1.3}
.lb-callout-box{font-size:var(--co-size);font-weight:var(--co-w);font-style:var(--co-style);line-height:1.45}
.lb-callout-box p+p{margin-top:.6em}
.lb-cta-box{background:var(--cta-bg);color:var(--cta-ink);border-radius:var(--cta-r);border-style:solid;border-width:var(--cta-bw);border-color:var(--cta-bc);padding:var(--cta-p);display:flex;flex-wrap:wrap;flex-direction:var(--cta-dir);align-items:var(--cta-items);justify-content:space-between;gap:20px 32px;text-align:var(--cta-align)}
.lb-cta-text{flex:1 1 auto;min-width:min(100%,300px);max-width:620px}
.lb-cta-text p{margin-top:10px;color:var(--cta-muted);font-size:17px}
.lb-cta .lb-actions{justify-content:var(--cta-items)}
.lb-cta .lb-btn{background:var(--cta-btn-bg);color:var(--cta-btn-ink)}
.lb-cta .lb-btn--ghost{background:transparent;color:inherit;border-color:currentColor}
.lb-embed figure{margin:0 auto;max-width:min(var(--wide),960px)}
.lb-embed-frame{aspect-ratio:16/9;border-radius:var(--r);overflow:hidden;background:var(--tint-2)}
.lb-embed-frame iframe{width:100%;height:100%;border:0;display:block}
.lb-embed figcaption{margin-top:10px;font-size:14px;color:var(--muted)}
.lb-linkcard{display:grid;gap:6px;padding:var(--card-p);background:var(--card-bg);border:1px solid var(--line);border-radius:var(--r);text-decoration:none}
.lb-linkcard-url{font-size:15px;color:var(--lead);overflow-wrap:anywhere}
.lb-row{display:flex;flex-wrap:wrap;gap:clamp(32px,6cqi,72px);padding:calc(var(--gap-y) / 2) var(--pad);max-width:calc(var(--wide) + var(--pad) * 2);margin:0 auto}
.lb-row>.lb{padding:0;flex:2 1 280px;min-width:0}
.lb-row>.lb:first-child{flex:3 1 380px}
.lb-row>.lb .lb-in{max-width:none}
.lb-prose .lb-in{max-width:min(var(--col),720px);font-size:18px;line-height:1.7}
.lb-prose .lb-in>*+*{margin-top:1em}
.lb-prose h2{font-size:clamp(22px,2.6cqi,28px);line-height:1.15;margin-top:1.6em}
.lb-prose h3{margin-top:1.4em}
.lb-prose ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:12px}
.lb-prose ul>li{display:flex;gap:14px}
.lb-prose ul>li::before{content:"";flex:none;width:8px;height:8px;border-radius:var(--dot-r);background:var(--hl);margin-top:.7em}
.lb-prose ol{padding-left:1.3em}
.lb-prose blockquote{margin:1.4em 0;padding:18px 0;border-style:solid;border-width:var(--quote-bw);border-color:var(--quote-bc);font-size:var(--quote-size);font-style:var(--quote-style);text-align:var(--quote-align);line-height:1.3}
.lb-prose a{color:var(--lead)}
.lb-prose img{border-radius:var(--img-r)}
.lb-prose pre{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:14px}
.lb-prose table{border-collapse:collapse;display:block;overflow-x:auto}
.lb-prose th,.lb-prose td{border:1px solid var(--line);padding:6px 10px}
.site--sub .lb-prose--first .lb-in>p:first-child::first-letter{float:var(--dc-float);font-size:var(--dc-size);line-height:var(--dc-lh);font-weight:var(--dc-w);margin:var(--dc-m);color:var(--dc-c)}
.mention{font-weight:600}
.lb-title{padding:clamp(28px,5cqi,64px) var(--pad) 0}
.lb-title-in{max-width:min(var(--col),820px);margin:0 auto;text-align:var(--hero-align)}
.lb-title h1{margin-top:14px}
.lb-title .lb-lede{margin-top:18px}
.lb-pager{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;max-width:min(var(--wide),960px);margin:calc(var(--gap-y) / 2) auto 0;padding:var(--sec-pt) var(--pad) calc(var(--gap-y) / 1.5);border-top:var(--sec-rule)}
.lb-pager a{display:flex;flex-direction:column;gap:6px;text-decoration:none;padding:14px 0}
.lb-pager-next{text-align:right}
.lb-pager-title{font-size:var(--h3);font-weight:var(--h-w);text-transform:var(--h-case);letter-spacing:calc(var(--h-track) * .5);line-height:1.2}
.page-foot{padding:20px var(--pad);border-top:1px solid var(--line);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--muted)}
.page-foot a{color:inherit}
`.replace(/\n/g, "");
