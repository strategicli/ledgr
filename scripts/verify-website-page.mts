// The Website Page render (src/modules/website-pages/lib/page-html.ts): blocks
// guess their parts from plain markdown, the page stays self-contained, and a
// mention never exposes an in-app address. Pure: no DB, no browser.
// Run: npx tsx scripts/verify-website-page.mts
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
check("footer rendered", html.includes('<footer class="page-foot">Shared from Tyler\'s Ledgr</footer>'));

// Hero guesses
check("hero with an image gets the art layout", html.includes('<section class="lb lb-hero lb-hero--art">'), html);
check("first image moves into the art column", /<div class="lb-hero-art"><img src="\/files\/abc\?s=tok" alt="Lake at dawn"><\/div>/.test(html), html);
check("a link-only paragraph becomes a button", html.includes('<p class="lb-actions"><a class="lb-btn" href="https://example.com/register">Register now</a></p>'), html);
check("headline stays in the text column as the page's h1", /<div class="lb-hero-text">\s*<h1 id="fall-retreat-2026">Fall Retreat 2026<\/h1>/.test(html), html);
check("a page with a hero gets no separate title header", !html.includes('class="lb-title"'));

// Cards
check("cards: intro kept above the grid", html.includes('<div class="lb-intro"><p>Everything you need to know.</p>'), html);
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
check("no hero: title header rendered and escaped", plain.includes('<header class="lb-title"><h1>Plain &lt;Page&gt;</h1></header>'), plain);

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
  check("home: collection title rendered", home.includes('<h2 class="lb-collection-title">Latest</h2>'), home);
  check("home: one card per matching published item", (home.match(/class="lb-item"/g) ?? []).length === 2);
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
  check("menu on phones behind a disclosure", page.includes('<details class="site-menu"><summary>Menu</summary>'));
}
{
  const sub = renderWebPage("Like a Weaned Child", "Contentment, slowly.", {
    site: SITE, currentHref: "/share/tok/like-a-weaned-child",
    meta: { publishedAt: "2026-09-05T00:00:00Z", backHref: "/share/tok", backLabel: "Morning Bread" },
  });
  check("subpage: back link and date under the title", sub.includes('<p class="lb-meta"><a href="/share/tok">← Morning Bread</a><span>Sep 5, 2026</span></p><h1>Like a Weaned Child</h1>'), sub);
  check("subpage: tab title names the site", sub.includes("<title>Like a Weaned Child · Morning Bread</title>"));
  check("headings get ids for #section menu links", renderWebPage("x", "## Our Story").includes('<h2 id="our-story">Our Story</h2>'));
}

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
