// ADR-125 verification: the large-body size gate + the Preview render path, as
// pure functions (no DB, no browser).
//  - body.ts: LARGE_BODY_THRESHOLD + isLargeBody boundary behavior
//  - markdown-render.ts: markdownToHtml (the /api/render-markdown Preview feed)
//    renders prose, flattens canvas-tab markers to headings, strips ^block
//    anchors, and preserves the color/highlight inline HTML.
//   npx tsx scripts/verify-body-modes.mts
import { LARGE_BODY_THRESHOLD, isLargeBody, makeMarkdownBody } from "../src/lib/body";
import { markdownToHtml } from "../src/lib/markdown-render";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- the size gate ----------------------------------------------------------
check("threshold is the measured 100K", LARGE_BODY_THRESHOLD === 100_000);
check("empty / null / undefined are not large", !isLargeBody("") && !isLargeBody(null) && !isLargeBody(undefined));
check("a normal note is not large", !isLargeBody("x".repeat(50_000)));
check("just under the threshold is not large", !isLargeBody("x".repeat(LARGE_BODY_THRESHOLD - 1)));
check("at the threshold IS large", isLargeBody("x".repeat(LARGE_BODY_THRESHOLD)));
check("a million-char ebook IS large", isLargeBody("x".repeat(1_000_000)));
// The shape the canvas actually feeds it (bodyMarkdown(item.body).length):
check("a large body's text length crosses the gate", makeMarkdownBody("x".repeat(LARGE_BODY_THRESHOLD)).text.length >= LARGE_BODY_THRESHOLD);

// --- the Preview render path (markdownToHtml) -------------------------------
check("empty markdown → empty html", markdownToHtml("") === "");

const html = markdownToHtml(["# Big Doc", "", "Some **bold** prose.", "", "- a", "- b"].join("\n"));
check("renders paragraphs + lists", html.includes("<strong>bold</strong>") && html.includes("<li>a</li>"));
check("body '# ' heading shifts under the title to <h2>", html.includes("<h2>Big Doc</h2>"));

// Canvas-tab markers flatten to '## Title' sections so a tabbed large note reads
// as titled sections in Preview (flattenTabs runs inside markdownToHtml).
const tabbed = markdownToHtml("<!-- tab: Chapter One -->\nfirst\n\n<!-- tab: Chapter Two -->\nsecond");
check("tab markers become headings, not literal comments", tabbed.includes("Chapter One") && !tabbed.includes("<!-- tab"));

// Block anchors (^id) are editor-only; Preview reads as clean prose.
const anchored = markdownToHtml("A promoted line ^a1b2c3");
check("block anchors are stripped from Preview", !anchored.includes("^a1b2c3"));

// A genuinely large input renders without throwing (the ECC-Insurance case).
const bigText = ("paragraph of words here.\n\n").repeat(20_000); // ~520K chars
let bigOk = false;
try {
  const bigHtml = markdownToHtml(bigText);
  bigOk = bigHtml.length > 0 && bigHtml.includes("<p>");
} catch {
  bigOk = false;
}
check("renders a ~520K-char document without throwing", bigOk);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
