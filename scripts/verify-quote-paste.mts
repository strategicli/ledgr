// Papers module P5 (v5 feedback) verification: the deterministic quote-paste
// parser. Pure, no DB — node IS the proof. Run: npx tsx scripts/verify-quote-paste.mts
import { parsePastedQuote } from "../src/lib/papers/parse-citation";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// Tyler's exact example: quoted span + trailing context + a book citation.
const example =
  '“Assurance is the fruit that grows out of the root of faith.” Believers need assurance. They need assurance that Jesus is who He claimed He was. Patrick Schreiner, The Visual Word: Illustrated Outlines of the New Testament Books, ed. Connor Sterchi (Chicago, IL: Moody Publishers, 2021), 160.';
const r = parsePastedQuote(example);
check("parses the example", r !== null);
if (r) {
  check("quote keeps the pre-citation text", r.text.startsWith("“Assurance") && r.text.includes("claimed He was."), r.text);
  check("quote drops the citation", !r.text.includes("Patrick Schreiner"));
  check("author", r.source.author === "Patrick Schreiner", r.source.author);
  check("authorLast", r.source.authorLast === "Schreiner", r.source.authorLast);
  check("title (full incl. subtitle)", r.source.title === "The Visual Word: Illustrated Outlines of the New Testament Books", r.source.title);
  check("shortTitle (before colon)", r.source.shortTitle === "The Visual Word", r.source.shortTitle);
  check("editor (name only, no 'ed.')", r.source.editor === "Connor Sterchi", r.source.editor);
  check("city", r.source.city === "Chicago, IL", r.source.city);
  check("publisher", r.source.publisher === "Moody Publishers", r.source.publisher);
  check("year", r.source.year === "2021", r.source.year);
  check("page", r.page === "160", r.page);
}

// A fully-quoted span with no trailing context, no editor.
const r2 = parsePastedQuote(
  '"The fear of the LORD is the beginning of wisdom." John Stott, The Cross of Christ (Downers Grove, IL: IVP, 2006), 12.'
);
check("variant: parses", r2 !== null);
if (r2) {
  check("variant: unwraps the fully-quoted span", r2.text === "The fear of the LORD is the beginning of wisdom.", r2.text);
  check("variant: no editor", r2.source.editor === undefined);
  check("variant: author/page", r2.source.author === "John Stott" && r2.page === "12");
}

// Citation-only paste (no quote text).
const r3 = parsePastedQuote("D. A. Carson, The Gospel According to John (Grand Rapids: Eerdmans, 1991), 200.");
check("citation-only: parses", r3 !== null);
if (r3) {
  check("citation-only: empty quote", r3.text === "", `"${r3.text}"`);
  check("citation-only: author/last", r3.source.author === "D. A. Carson" && r3.source.authorLast === "Carson");
}

// No recognizable citation → null (caller dumps raw into the quote field).
check("unrecognized → null", parsePastedQuote("Just a stray thought with no citation.") === null);
check("empty → null", parsePastedQuote("   ") === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
