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
check("headline stays in the text column as the page's h1", /<div class="lb-hero-text">\s*<h1>Fall Retreat 2026<\/h1>/.test(html), html);
check("a page with a hero gets no separate title header", !html.includes('class="lb-title"'));

// Cards
check("cards: intro kept above the grid", html.includes('<div class="lb-intro"><p>Everything you need to know.</p>'), html);
const cards = html.match(/<article class="lb-card">/g) ?? [];
check("cards: one card per ### heading", cards.length === 2, String(cards.length));
check("cards: card holds its heading (level as written) and text", /<article class="lb-card"><h3>Lodging<\/h3>\s*<p>Cabins sleep 8.<\/p>/.test(html), html);

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

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
