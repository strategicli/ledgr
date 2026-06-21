// Verifies the web-clipper extraction (ADR-099): article HTML -> clean markdown
// with images stripped and links absolutized. Pure, no DB/network.
//   npx tsx scripts/verify-clip-extract.mts
import { extractArticle } from "../src/lib/clip/extract";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const PAGE_URL = "https://example.com/blog/post";
const html = `<!doctype html><html><head><title>Sample &amp; Title</title></head>
<body>
  <nav>site nav junk that readability should drop</nav>
  <article>
    <h1>The Heading</h1>
    <p>First paragraph with a <a href="/relative/link">relative link</a> and an
       <a href="https://other.com/abs">absolute link</a>.</p>
    <p>An image we never keep: <img src="/photo.jpg" alt="a photo"> end.</p>
    <figure><img src="/big.png"><figcaption>cap</figcaption></figure>
    <ul><li>one</li><li>two</li></ul>
    <p>Trailing paragraph to give the article enough text content so Readability
       treats this as the main article and not boilerplate. More words here so
       the scorer is comfortable picking this node as the article body.</p>
  </article>
  <footer>footer junk</footer>
</body></html>`;

const article = extractArticle(html, PAGE_URL);
check("extracts an article", article !== null);

if (article) {
  const md = article.markdown;
  check("title cleaned + entity-decoded", article.title === "Sample & Title");
  check("heading kept as atx", md.includes("# The Heading"));
  check("list kept", /- +one/.test(md) && /- +two/.test(md));
  check("paragraph text kept", md.includes("First paragraph"));

  // Images: nothing image-shaped survives.
  check("no markdown image syntax", !/!\[/.test(md));
  check("no <img tag leaked", !/<img/i.test(md));
  check("no photo.jpg reference", !md.includes("photo.jpg") && !md.includes("big.png"));

  // Links: relative absolutized against the page URL, absolute preserved.
  check(
    "relative link absolutized",
    md.includes("(https://example.com/relative/link)")
  );
  check("absolute link preserved", md.includes("(https://other.com/abs)"));
  check("link text kept", md.includes("[relative link]"));
}

// A page with no real article content yields null (caller falls back to URL).
const empty = extractArticle("<html><body></body></html>", PAGE_URL);
check("empty page -> null", empty === null);

console.log(`\nclip-extract: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
