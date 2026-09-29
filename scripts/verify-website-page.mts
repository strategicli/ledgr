// The Website Page render (src/modules/website-pages/lib/page-html.ts): blocks
// guess their parts from plain markdown, the page stays self-contained, and a
// mention never exposes an in-app address. Pure: no DB, no browser.
// Run: npx tsx scripts/verify-website-page.mts
/* eslint-disable @typescript-eslint/no-explicit-any -- dev-only harness: it pokes
   at union results (embedFor) loosely; this script never ships in the app. */
const { renderWebPage } = await import("../src/modules/website-pages/lib/page-html");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `\n      ${detail.slice(0, 400)}` : ""}`);
  if (!ok) failures += 1;
}

const ID_LINK = "11111111-1111-4111-8111-111111111111";
const ID_SHARED = "22222222-2222-4222-8222-222222222222";
const ID_PRIVATE = "33333333-3333-4333-8333-333333333333";

const BODY = [
  "::: hero",
  "",
  "![Lake at dawn](/files/abc?s=tok)",
  "",
  "# Fall Retreat 2026",
  "",
  "A weekend away to rest and reset.",
  "",
  "[Register now](https://example.com/register)",
  "",
  ":::",
  "",
  "::: cards",
  "",
  "Everything you need to know.",
  "",
  "### Lodging",
  "",
  "Cabins sleep 8.",
  "",
  "### Cost",
  "",
  "$120 per person.",
  "",
  ":::",
  "",
  "::: callout",
  "",
  "**Bring a flashlight.** The path is not lit. {>>owner-only note<<}",
  "",
  ":::",
  "",
  "::: someday-block",
  "",
  "Still readable.",
  "",
  ":::",
  "",
  `Questions? See [@Registration form](ledgr://item/${ID_LINK}), [@FAQ](ledgr://item/${ID_SHARED}) or ask [@Tyler](ledgr://item/${ID_PRIVATE}).`,
].join("\n");

const html = renderWebPage("Fall Retreat", BODY, {
  publicLinks: new Map([
    [ID_LINK, "https://example.com/form"],
    [ID_SHARED, "/share/abc123"],
  ]),
  footerHtml: "Shared from Tyler's Ledgr",
});

// Page shell
check("self-contained document", html.startsWith("<!doctype html>") && html.includes("<style>"));
check("no scripts on the page", !/<script/i.test(html));
check("title in <title>", html.includes("<title>Fall Retreat</title>"));
check("dark palette via the viewer's system setting", html.includes("prefers-color-scheme:dark"));
check("footer rendered", html.includes("<footer class=\"page-foot\"><span></span><span>Shared from Tyler's Ledgr</span></footer>"), html);

// Hero guesses
check("hero with an image gets the art layout", html.includes('<section class="lb-hero lb-hero--art">'), html);
check("first image moves into the art column", /<div class="lb-hero-art"><img src="\/files\/abc\?s=tok" alt="Lake at dawn"><\/div>/.test(html), html);
check("a link-only paragraph becomes a button", html.includes('<div class="lb-actions"><a class="lb-btn" href="https://example.com/register">Register now</a></div>'), html);
check("headline becomes the page's h1", /<div class="lb-hero-txt-in">\s*<h1 id="fall-retreat-2026">Fall Retreat 2026<\/h1>/.test(html), html);
check("a page with a hero gets no separate title header", !html.includes('class="lb-title"'));

// Cards
check("cards: a lone intro line becomes the section label", html.includes('<div class="lb-head"><div class="lb-label">Everything you need to know.</div></div>'), html);
const cards = html.match(/<article class="lb-card">/g) ?? [];
check("cards: one card per ### heading", cards.length === 2, String(cards.length));
check("cards: card holds its heading (level as written) and text", /<article class="lb-card"><h3 id="lodging">Lodging<\/h3>\s*<p>Cabins sleep 8.<\/p>/.test(html), html);

// Callout, unknown blocks, comments
check("callout renders as its section", html.includes('<section class="lb lb-callout">'));
check("owner comments never reach the page", !html.includes("owner-only note"));
check("an unknown block still renders its content", /<section class="lb lb-someday-block"><p>Still readable.<\/p>\s*<\/section>/.test(html), html);
check("no fence line leaks", !html.includes(":::"));

// Public mention rule
check("Link item mention links to its URL", html.includes('<a href="https://example.com/form" class="mention">@Registration form</a>'), html);
check("shared item mention links to its share page", html.includes('<a href="/share/abc123" class="mention">@FAQ</a>'), html);
check("other mentions are plain text", html.includes('<span class="mention">@Tyler</span>'), html);
check("no in-app address anywhere", !html.includes("/items/") && !html.includes("ledgr://"), html);

// No hero: the title stands in
const plain = renderWebPage("Plain <Page>", "Just text.");
check("no hero: title header rendered and escaped", plain.includes('<h1>Plain &lt;Page&gt;</h1>'), plain);

// --- Sites: collections, menu, subpages, publish list -------------------------
console.log("\nSites");
const { readPublications, withPublished, withUnpublished, slugify } = await import(
  "../src/modules/website-pages/lib/publications"
);
const { selectCollection, summarize } = await import("../src/modules/website-pages/lib/page-html");

{
  let list = withPublished([], { id: ID_LINK, title: "The Lord Who Keeps" }, new Date("2026-09-01T00:00:00Z"));
  list = withPublished(list, { id: ID_SHARED, title: "The Lord Who Keeps" }, new Date("2026-09-02T00:00:00Z"));
  check("publish: slug from the title", list[0].slug === "the-lord-who-keeps");
  check("publish: a second item with the same title gets a unique slug", list[1].slug === "the-lord-who-keeps-2");
  check("publish: re-publishing keeps the slug and date", withPublished(list, { id: ID_LINK, title: "Renamed" }) === list);
  check("unpublish removes only that item", withUnpublished(list, ID_LINK).map((p) => p.id).join() === ID_SHARED);
  check("read tolerates junk entries", readPublications({ publications: [list[0], { id: "nope" }, null, 5] }).length === 1);
  check("slugify folds accents and punctuation", slugify("Café: Psalm 121!") === "cafe-psalm-121");
}

const mk = (id: string, title: string, type: string, tags: string[], at: string, bodyText = "") => ({
  id, slug: slugify(title), href: `/share/tok/${slugify(title)}`, title, type, tags, publishedAt: at, bodyText,
});
const ITEMS = [
  mk(ID_LINK, "Unless the Lord Builds", "devotional", ["Psalms of Ascent"], "2026-09-12T00:00:00Z", "![](/files/x?s=tok)\n\nEarly mornings are not the problem."),
  mk(ID_SHARED, "Like a Weaned Child", "devotional", ["psalms-of-ascent", "rest"], "2026-09-05T00:00:00Z", "Contentment, slowly."),
  mk(ID_PRIVATE, "About", "website-page", [], "2026-09-01T00:00:00Z", "::: hero\n\n# About me\n\n:::"),
];
{
  check("collection: filters by type", selectCollection(ITEMS, { type: "Devotional" }).length === 2);
  check("collection: plural type label works", selectCollection(ITEMS, { type: "Devotionals" }).length === 2);
  check("collection: tag match ignores case, spaces and #", selectCollection(ITEMS, { tag: "#Psalms of Ascent" }).length === 2);
  const oldest = selectCollection(ITEMS, { type: "devotional", show: "1 oldest" });
  check("collection: show N oldest", oldest.length === 1 && oldest[0].title === "Like a Weaned Child");
  check("collection: newest first by default", selectCollection(ITEMS, {})[0].title === "Unless the Lord Builds");
  const sum = summarize(ITEMS[0].bodyText);
  check("summary: first image found", sum.image === "/files/x?s=tok", String(sum.image));
  check("summary: excerpt is plain text without the image", sum.excerpt === "Early mornings are not the problem.", sum.excerpt);
}

const SITE = { name: "Morning Bread", homeHref: "/share/tok", homeMarkdown: "", items: ITEMS };
{
  const home = renderWebPage("Morning Bread", "::: collection\n\ntitle: Latest\ntype: Devotional\nshow: 5 newest\n\n:::", {
    site: SITE, currentHref: "/share/tok",
  });
  check("home: collection title rendered", home.includes('<div class="lb-head"><h2 id="latest">Latest</h2></div>'), home);
  check("home: one card per matching published item", (home.match(/class="lb-card lb-item"/g) ?? []).length === 2, home);
  check("home: card links to the subpage", home.includes('href="/share/tok/unless-the-lord-builds"'));
  check("home: settings lines never show as text", !home.includes("show: 5 newest"));
  check("home: automatic menu = Home + published pages", /<nav class="site-nav"[^>]*><a href="\/share\/tok" aria-current="page">Home<\/a><a href="\/share\/tok\/about">About<\/a><\/nav>/.test(home), home);
  check("home: site name in the header", home.includes('<a class="site-name" href="/share/tok">Morning Bread</a>'));
}
{
  const withMenu = { ...SITE, homeMarkdown: `::: menu\n\n- [@About](ledgr://item/${ID_PRIVATE})\n- [Podcast](https://example.com/pod)\n\n:::` };
  const page = renderWebPage("Morning Bread", withMenu.homeMarkdown, {
    site: withMenu, currentHref: "/share/tok/about", publicLinks: new Map([[ID_PRIVATE, "/share/tok/about"]]),
  });
  check("menu block: mention goes to the subpage, marked current", page.includes('<a href="/share/tok/about" aria-current="page">@About</a>'), page);
  check("menu block: plain URL kept", page.includes('<a href="https://example.com/pod">Podcast</a>'));
  check("menu block: not rendered in the body", !/<main class="page">[\s\S]*Podcast[\s\S]*<\/main>/.test(page), page);
  const plainMenu = renderWebPage("x", "::: menu\n\n- Coming soon\n- [Blog](https://example.com)\n\n:::", { site: { ...SITE, homeMarkdown: "::: menu\n\n- Coming soon\n- [Blog](https://example.com)\n\n:::" } });
  check("menu block: a line with no link still shows, as text", plainMenu.includes('<span>Coming soon</span><a href="https://example.com">Blog</a>'), plainMenu);
  check("menu on phones behind a disclosure", page.includes('<details class="site-menu"><summary>Menu</summary>'));
}
{
  const sub = renderWebPage("Like a Weaned Child", "Contentment, slowly.", {
    site: SITE, currentHref: "/share/tok/like-a-weaned-child",
    meta: { label: "Devotional", publishedAt: "2026-09-05T00:00:00Z" },
  });
  check("subpage: label and date above the title", sub.includes('<div class="lb-label">Devotional · Sep 5, 2026 · 1 min read</div><h1>Like a Weaned Child</h1>'), sub);
  check("subpage: tab title names the site", sub.includes("<title>Like a Weaned Child · Morning Bread</title>"));
  check("headings get ids for #section menu links", renderWebPage("x", "## Our Story").includes('<h2 id="our-story">Our Story</h2>'));
}

// --- Design system + the Personal Site blocks ---------------------------------
console.log("\nDesign and blocks");
const { readDesign, themeCss } = await import("../src/modules/website-pages/lib/theme");
const { embedFor } = await import("../src/modules/website-pages/lib/page-html");
const { STARTERS } = await import("../src/modules/website-pages/lib/starters");
{
  check("design: default when unset", JSON.stringify(readDesign({})) === JSON.stringify({ language: "modern", palette: "slate", font: "public" }));
  check("design: unknown values fall back, font follows language", JSON.stringify(readDesign({ design: { language: "editorial", palette: "nope" } })) === JSON.stringify({ language: "editorial", palette: "slate", font: "serif" }));
  const css = themeCss({ language: "bold", palette: "navy", font: "montserrat" });
  check("theme: language tokens present", css.includes("--h-case:uppercase"));
  check("theme: palette light + dark", css.includes("--lead:#1d3b66") && /prefers-color-scheme:dark\)\{:root\{--lead:#8fb4ea/.test(css));
  const page = renderWebPage("x", "Hi", { design: { language: "editorial", palette: "navy", font: "serif" } });
  check("font: self-hosted face for the page's font only", page.includes("/fonts/pages/source-serif-4-normal.woff2") && !page.includes("public-sans"));
  check("font: Helvetica ships no file", !renderWebPage("x", "Hi", { design: { language: "modern", palette: "slate", font: "helvetica" } }).includes("@font-face"));
}
{
  check("embed: YouTube goes through youtube-nocookie", (embedFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ") as any)?.src === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  check("embed: youtu.be short links", (embedFor("https://youtu.be/dQw4w9WgXcQ") as any)?.src === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  check("embed: Vimeo player", (embedFor("https://vimeo.com/76979871") as any)?.src === "https://player.vimeo.com/video/76979871");
  check("embed: other sites become a link card", embedFor("https://example.com/talk")?.kind === "link");
  check("embed: non-web schemes refused", embedFor("javascript:alert(1)") === null);
}
{
  const html = renderWebPage("x", [
    "::: timeline", "", "## Now", "", "- **Reading** Jayber Crow. _Second time through_", "", ":::", "",
    "::: stats", "", "- **Started** March 2023", "", ":::", "",
    "::: quotes", "", "> Lovely.", ">", "> — Carla M.", "", ":::", "",
    "::: cta", "", "## Say hello", "", "Email is best.", "", "[Email me](mailto:a@b.c) [Call](https://example.com/c)", "", ":::", "",
    "::: embed", "", "https://youtu.be/dQw4w9WgXcQ", "", "Our anniversary film", "", ":::", "",
    ":::: row", "", "::: callout", "", "One", "", ":::", "", "::: callout", "", "Two", "", ":::", "", "::::", "",
    "::: hero", "", "![portrait](placeholder)", "", "# Hi", "", ":::",
  ].join("\n"));
  check("timeline: label, title, detail", html.includes('<span class="lb-tl-when">Reading</span>') && html.includes('<div class="lb-tl-title">Jayber Crow</div><div class="lb-tl-detail">Second time through</div>'), html);
  check("stats: label and value", html.includes('<div class="lb-stat-label">Started</div><div class="lb-stat-value">March 2023</div>'), html);
  check("quotes: attribution from the last line", html.includes('<figure class="lb-quote"><p>Lovely.</p><figcaption>Carla M.</figcaption></figure>'), html);
  check("cta: first button solid, second outlined", html.includes('<a class="lb-btn" href="mailto:a@b.c">Email me</a><a class="lb-btn lb-btn--ghost" href="https://example.com/c">Call</a>'), html);
  check("embed block: player + caption", html.includes('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"') && html.includes("<figcaption>Our anniversary film</figcaption>"), html);
  check("row: blocks side by side", /<div class="lb-row"><section class="lb lb-callout">[\s\S]*?<section class="lb lb-callout">/.test(html), html);
  check("placeholder image draws the stand-in box", html.includes('<span class="lb-ph" role="img" aria-label="portrait">portrait</span>'), html);
}
{
  const { withIcons } = await import("../src/modules/website-pages/lib/page-html");
  const ic = withIcons("<p>Call :home: now</p>");
  check("icons: :home: becomes the Ledgr home icon", /<p>Call <svg class="lb-icon"[^>]*><path d="M3 11\.5/.test(ic), ic);
  check("icons: unknown names stay text", withIcons("<p>:not-an-icon:</p>") === "<p>:not-an-icon:</p>");
  check("icons: times and fences are left alone", withIcons("<p>10:30:45 and ::: hero</p>") === "<p>10:30:45 and ::: hero</p>");
  check("icons: code is never touched", withIcons("<code>:home:</code>") === "<code>:home:</code>");
  const cols = renderWebPage("x", "::: columns\n\n### :home: Home\n\nText\n\n:::");
  check("icons: a column heading's icon renders first in the heading", /<h3 id="home"><svg class="lb-icon"/.test(cols), cols);
}
{
  const j = STARTERS.find((x) => x.id === "journal")!;
  const mkj = (n: number, title: string, tags: string[], at: string, body = "Text.") => ({ id: `0000000${n}-0000-4000-8000-000000000000`, slug: `s${n}`, href: `/share/tok/s${n}`, title, type: "devotional", tags, publishedAt: at, bodyText: body });
  const items = [
    mkj(1, "Featured one", ["featured", "Hope"], "2026-09-25T00:00:00Z", "![spring](placeholder)\n\nHagar names God."),
    mkj(4, "Far from home", ["psalms-of-ascent", "Psalm 120"], "2026-09-01T00:00:00Z"),
    mkj(5, "Help from the hills", ["psalms-of-ascent", "Psalm 121"], "2026-09-03T00:00:00Z"),
  ];
  const html = renderWebPage("Still Water", j.body, { site: { name: "Still Water", homeHref: "/share/tok", homeMarkdown: j.body, items }, design: j.design });
  check("journal: featured collection is the hero, no title header", /<h1[^>]*>Featured one<\/h1>/.test(html) && !html.includes('class="lb-title"'), html);
  check("journal: hero button goes to the piece", html.includes('<a class="lb-btn" href="/share/tok/s1">Read today&#39;s devotional</a>') || html.includes("<a class=\"lb-btn\" href=\"/share/tok/s1\">Read today's devotional</a>"), html);
  check("journal: series numbered oldest first", /lb-series-n">1<\/span><span class="lb-series-meta">Psalm 120<\/span><h3[^>]*>Far from home/.test(html), html);
  check("journal: topics count tags, minus excluded", html.includes('Hope<span class="lb-tag-n">1</span>') && !html.includes(">Featured<span"), html);
}
{
  const s = STARTERS.find((x) => x.id === "personal-site")!;
  const html = renderWebPage("Jonah Reyes", s.body, { site: { name: "Jonah Reyes", homeHref: "/share/tok", homeMarkdown: s.body, items: [] }, design: s.design });
  check("starter: renders with its menu in the header", html.includes('<a href="#things-ive-made">Work</a>'), html);
  check("starter: menu anchor matches its section id", html.includes('id="things-ive-made"'));
  check("starter: footer block lands in the footer", html.includes("you@example.com · Kansas City, MO"));
  check("starter: empty collections say so", html.includes("Nothing published here yet."));
  check("starter: no fence or settings text leaks", !html.includes(":::") && !html.includes("show: 6 newest"));
}

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
