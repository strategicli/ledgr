// Verification for the Pulpit Ready print renderer (slice 18): bodyToHtml
// is a pure function, so this needs no DB. Run: npx tsx scripts/verify-print.mts
import { bodyToHtml, escapeHtml } from "../src/lib/print-html";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, got?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${got !== undefined ? `\n      got: ${got}` : ""}`);
  }
}

const p = (text: string, props = {}) => ({
  type: "paragraph",
  props,
  content: [{ type: "text", text, styles: {} }],
});

// --- escaping ---
check(
  "escapeHtml escapes the four",
  escapeHtml(`<a b="c">&`) === "&lt;a b=&quot;c&quot;&gt;&amp;"
);
{
  const out = bodyToHtml([p(`<script>alert("x")</script>`)]);
  check("body text is escaped", !out.includes("<script>") && out.includes("&lt;script&gt;"), out);
}

// --- blocks ---
{
  const out = bodyToHtml([
    { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Sermon", styles: {} }] },
  ]);
  check("heading level 1 renders as h2 (h1 is the title)", out === "<h2>Sermon</h2>", out);
}
{
  const out = bodyToHtml([
    { type: "heading", props: { level: 99 }, content: [{ type: "text", text: "x", styles: {} }] },
  ]);
  check("heading level clamps to h6", out === "<h6>x</h6>", out);
}
{
  const out = bodyToHtml([
    { type: "quote", props: {}, content: [{ type: "text", text: "Selah", styles: {} }] },
  ]);
  check("quote", out === "<blockquote>Selah</blockquote>", out);
}
{
  const out = bodyToHtml([
    { type: "codeBlock", props: { language: "js" }, content: [{ type: "text", text: "a < b && c", styles: {} }] },
  ]);
  check("code block escapes raw", out === "<pre><code>a &lt; b &amp;&amp; c</code></pre>", out);
}
check("divider", bodyToHtml([{ type: "divider", props: {}, content: [] }]) === "<hr>");

// --- lists group ---
{
  const li = (text: string) => ({
    type: "bulletListItem",
    props: {},
    content: [{ type: "text", text, styles: {} }],
  });
  const out = bodyToHtml([li("a"), li("b"), p("after")]);
  check(
    "consecutive bullets share one ul, paragraph closes it",
    out === "<ul><li>a</li><li>b</li></ul><p>after</p>",
    out
  );
}
{
  const out = bodyToHtml([
    { type: "numberedListItem", props: {}, content: [{ type: "text", text: "one", styles: {} }] },
    { type: "bulletListItem", props: {}, content: [{ type: "text", text: "dot", styles: {} }] },
  ]);
  check("ol closes before ul", out === "<ol><li>one</li></ol><ul><li>dot</li></ul>", out);
}
{
  const out = bodyToHtml([
    { type: "checkListItem", props: { checked: true }, content: [{ type: "text", text: "done", styles: {} }] },
    { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "todo", styles: {} }] },
  ]);
  check(
    "checklist glyphs",
    out.includes("☑</span> done") && out.includes("☐</span> todo"),
    out
  );
}
{
  // Nested children render inside the parent li.
  const out = bodyToHtml([
    {
      type: "bulletListItem",
      props: {},
      content: [{ type: "text", text: "parent", styles: {} }],
      children: [
        { type: "bulletListItem", props: {}, content: [{ type: "text", text: "child", styles: {} }] },
      ],
    },
  ]);
  check("nested list inside li", out === "<ul><li>parent<ul><li>child</li></ul></li></ul>", out);
}

// --- inline styles ---
{
  const out = bodyToHtml([
    {
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: "b", styles: { bold: true } },
        { type: "text", text: "i", styles: { italic: true } },
        { type: "text", text: "c", styles: { code: true } },
        { type: "text", text: "red", styles: { textColor: "red" } },
        { type: "text", text: "hl", styles: { backgroundColor: "yellow" } },
      ],
    },
  ]);
  check("bold/italic/code", out.includes("<strong>b</strong>") && out.includes("<em>i</em>") && out.includes("<code>c</code>"), out);
  check("text color inline span", out.includes(`<span style="color:#e03e3e">red</span>`), out);
  check("highlight mark class", out.includes(`<mark class="hl-yellow">hl</mark>`), out);
}
{
  const out = bodyToHtml([
    {
      type: "paragraph",
      props: {},
      content: [
        { type: "link", href: "https://x.test/?a=1&b=2", content: [{ type: "text", text: "go", styles: {} }] },
        { type: "mention", props: { title: "Roger Smith", itemId: "abc" } },
      ],
    },
  ]);
  check("link href escaped", out.includes(`href="https://x.test/?a=1&amp;b=2"`), out);
  check("mention renders styled, not a link", out.includes(`<span class="mention">@Roger Smith</span>`) && !out.includes("ledgr://"), out);
}

// --- image / table / unknown ---
{
  const out = bodyToHtml([
    { type: "image", props: { url: "https://r2.test/a.png", name: "a", caption: "cap" }, content: [] },
  ]);
  check("image with caption", out.includes(`<img src="https://r2.test/a.png"`) && out.includes("<figcaption>cap</figcaption>"), out);
}
{
  const out = bodyToHtml([
    {
      type: "table",
      props: {},
      content: {
        rows: [
          { cells: [{ type: "tableCell", content: [{ type: "text", text: "h1", styles: {} }] }] },
          { cells: [{ type: "tableCell", content: [{ type: "text", text: "v|1", styles: {} }] }] },
        ],
      },
    },
  ]);
  check("table renders rows", out === "<table><tr><td>h1</td></tr><tr><td>v|1</td></tr></table>", out);
}
{
  const out = bodyToHtml([
    { type: "futureQueryView", props: {}, content: [{ type: "text", text: "fallback text", styles: {} }] },
  ]);
  check("unknown block degrades to text", out === "<p>fallback text</p>", out);
}
{
  const out = bodyToHtml([
    { type: "paragraph", props: { backgroundColor: "blue", textColor: "red" }, content: [{ type: "text", text: "x", styles: {} }] },
  ]);
  check("block colors apply", out.includes("color:#e03e3e") && out.includes("background-color:#ddebf1"), out);
}
check("null body", bodyToHtml(null) === "");
check("empty paragraph renders nothing", bodyToHtml([p("")]) === "");
check("pageBreak", bodyToHtml([{ type: "pageBreak", props: {}, content: [] }]) === `<div class="page-break"></div>`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
