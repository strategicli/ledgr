// Papers module (v5) verification: the outline-viewer HTML generator. Pure, no
// DB. Run: npx tsx scripts/verify-outline-html.mts
import { buildOutlineHtml } from "../src/lib/papers/outline-html";
import type { OutlineSection, QuoteEntry } from "../src/lib/papers/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const sections: OutlineSection[] = [
  { id: "s1", title: "Background", paragraphs: [{ id: "p1", title: "Authorship", note: "Petrine authorship.\n\nEarly church agreed." }] },
];
const quotes: QuoteEntry[] = [
  {
    id: "q1",
    paragraphId: "p1",
    text: "Doubt is a modern phenomenon.",
    page: "830",
    source: { kind: "book", author: "A. Köstenberger", authorLast: "Köstenberger", title: "The Cradle", shortTitle: "Cradle", city: "Nashville", publisher: "B&H", year: "2009" },
  },
  {
    id: "q2",
    sectionId: "s1",
    text: "A section-level quote.",
    source: { kind: "book", author: "John Stott", authorLast: "Stott", title: "The Cross", shortTitle: "Cross", city: "Downers Grove", publisher: "IVP", year: "2006" },
  },
];

const html = buildOutlineHtml({ title: "1 Peter", subtitle: "NT 5183", sections, quotes });

check("standalone document", html.startsWith("<!DOCTYPE html>") && html.includes("</html>"));
check("title + subtitle", html.includes("1 Peter") && html.includes("NT 5183"));
check("section + paragraph titles", html.includes(">Background<") && html.includes("Authorship"));
check("note renders as paragraphs (blank line → two <p>)", (html.match(/<p class="note">/g)?.length ?? 0) === 2);
check("paragraph quote text shown", html.includes("Doubt is a modern phenomenon."));
check("section-level quote shown", html.includes("A section-level quote."));
check("quote shows text only (no always-visible source line)", !html.includes('class="quote-source"'));
check("footnote forms are in the click-to-roll popup", html.includes('class="fn-popup"') && html.includes('class="fn-copy"'));
check("Full footnote copy payload is plain", html.includes('data-copy="A. Köstenberger, The Cradle (Nashville: B&amp;H, 2009), 830."'));
check("bibliography section present", html.includes(">Bibliography<"));
check("bibliography inverts + sorts by surname (Köstenberger before Stott)", html.indexOf("Köstenberger, A.") < html.indexOf("Stott, John") && html.includes("Köstenberger, A."));
check("click-to-copy script present", html.includes("navigator.clipboard.writeText"));

// Empty/half-filled sources must not produce ". **. : , ." bibliography noise.
const withEmpty = buildOutlineHtml({
  title: "T",
  sections: [{ id: "s1", title: "S", paragraphs: [{ id: "p1" }] }],
  quotes: [
    { id: "e", paragraphId: "p1", text: "", source: { kind: "book", author: "", authorLast: "", title: "", shortTitle: "", city: "", publisher: "", year: "" } },
  ],
});
check("empty source is skipped in the bibliography", !withEmpty.includes(">Bibliography<"));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
