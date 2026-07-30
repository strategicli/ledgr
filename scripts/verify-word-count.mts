// Verifies the live canvas word count (src/lib/word-count.ts) with no DB and no
// browser: the count itself, the debounced trailing recount, and the item-id
// scoping that keeps a canvas modal's editor from rewriting the underlying page's
// count.
//   npx tsx scripts/verify-word-count.mts
import { wordCountOf } from "../src/lib/body";
import { publishBodyMarkdown, peekWordCount } from "../src/lib/word-count";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- the count --------------------------------------------------------------
check("plain prose", wordCountOf("one two three") === 3);
check("markdown punctuation doesn't count", wordCountOf("# Title\n\n- a\n- b") === 3);
check("contractions and hyphens are one word", wordCountOf("don't re-count won’t") === 3);
check("empty body", wordCountOf("") === 0);

// --- the debounced publish --------------------------------------------------
check("nothing published yet", peekWordCount("item-a") === null);
publishBodyMarkdown("item-a", "one two three");
publishBodyMarkdown("item-a", "one two three four");
check("not recounted on the keystroke", peekWordCount("item-a") === null);

await new Promise((r) => setTimeout(r, 1200));
check(
  "trailing recount lands, latest text wins",
  peekWordCount("item-a") === 4,
  String(peekWordCount("item-a"))
);
check("another item is unaffected", peekWordCount("item-b") === null);

// A second item publishing takes over the slot (one canvas is in focus at a
// time); the first then falls back to its server-rendered count.
publishBodyMarkdown("item-b", "five six");
await new Promise((r) => setTimeout(r, 1200));
check("scoped to the publishing item", peekWordCount("item-b") === 2);
check("previous item falls back to its server count", peekWordCount("item-a") === null);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
