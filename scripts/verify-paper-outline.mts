// Papers module (v5) verification: the outline filing helpers (section / paragraph
// / unsorted tokens). Pure, no DB. Run: npx tsx scripts/verify-paper-outline.mts
import {
  applyToken,
  destinationsFor,
  quoteToken,
  quotesForParagraph,
  sectionLevelQuotes,
  unsortedQuotes,
} from "../src/lib/papers/outline";
import type { OutlineSection, QuoteEntry } from "../src/lib/papers/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const sections: OutlineSection[] = [
  { id: "s1", title: "Authorship", paragraphs: [{ id: "p1" }, { id: "p2", title: "Date" }] },
  { id: "s2", title: "Outline", paragraphs: [{ id: "p3" }] },
];
const src = { kind: "book", author: "A B", authorLast: "B", title: "T", shortTitle: "T", city: "C", publisher: "P", year: "2020" } as const;
const quotes: QuoteEntry[] = [
  { id: "q1", source: src, text: "para quote", paragraphId: "p1" },
  { id: "q2", source: src, text: "section quote", sectionId: "s1" },
  { id: "q3", source: src, text: "unsorted quote" },
  { id: "q4", source: src, text: "dangling", paragraphId: "gone" },
];

check("paragraph-level token", quoteToken(quotes[0], sections) === "p:p1");
check("section-level token", quoteToken(quotes[1], sections) === "s:s1");
check("unsorted token", quoteToken(quotes[2], sections) === "unsorted");
check("dangling paragraphId reads as unsorted", quoteToken(quotes[3], sections) === "unsorted");

check("applyToken paragraph", JSON.stringify(applyToken("p:p1")) === JSON.stringify({ paragraphId: "p1" }));
check("applyToken section", JSON.stringify(applyToken("s:s1")) === JSON.stringify({ sectionId: "s1" }));
check("applyToken unsorted", JSON.stringify(applyToken("unsorted")) === JSON.stringify({}));

const dests = destinationsFor(sections);
check("destinations include section level", dests.some((d) => d.token === "s:s1" && d.label.includes("(whole section)")));
check("destinations include titled paragraph", dests.some((d) => d.token === "p:p2" && d.label === "Authorship · Date"));
check("destinations include untitled paragraph", dests.some((d) => d.token === "p:p1" && d.label === "Authorship · Paragraph 1"));

check("quotesForParagraph", quotesForParagraph(quotes, "p1").length === 1);
check("sectionLevelQuotes excludes paragraph quotes", sectionLevelQuotes(quotes, "s1").length === 1 && sectionLevelQuotes(quotes, "s1")[0].id === "q2");
check("unsortedQuotes includes the unfiled + dangling", unsortedQuotes(quotes, sections).map((q) => q.id).sort().join(",") === "q3,q4");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
