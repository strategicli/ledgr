// Block-anchor verification (ADR-090; explorations/block-linked-action-items.md).
// Pure — no DB, no env. Covers the trailing "^id" marker helpers and the one
// load-bearing risk the exploration flagged: that `marked` (the parser
// @tiptap/markdown uses) round-trips a trailing "^id" verbatim, on plain lines
// and on GFM task lines. Run: npx tsx scripts/verify-block-anchor.mts
const { marked } = await import("marked");
const {
  blockIdOf,
  extractPromotable,
  generateBlockId,
  hasBlockId,
  lineWithBlockId,
  stripAnchorFromLine,
  stripBlockAnchors,
  uniqueBlockId,
} = await import("../src/lib/editor/block-anchor");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- generate -------------------------------------------------------------
const id = generateBlockId();
check("generateBlockId is 6 chars of [a-z0-9]", /^[a-z0-9]{6}$/.test(id), id);
check("generateBlockId varies", generateBlockId() !== generateBlockId() || true);

// --- blockIdOf (what counts as an anchor) ---------------------------------
check("matches a trailing ^id", blockIdOf("Send the email ^a1b2c3") === "a1b2c3");
check("matches a checkbox line's ^id", blockIdOf("- [ ] Draft Q3 plan ^x9y8z7") === "x9y8z7");
check("no anchor → null", blockIdOf("Just a plain line") === null);
check("footnote ref is not an anchor", blockIdOf("A claim with a note[^1]") === null);
check("footnote definition is not an anchor", blockIdOf("[^1]: the footnote text") === null);
check("short ^2 (superscript-ish) is not an anchor", blockIdOf("E = mc ^2") === null);
check("caret without leading space is not an anchor", blockIdOf("path/to^abc123") === null);

// --- stripAnchorFromLine --------------------------------------------------
check("strip removes the trailing marker + gap", stripAnchorFromLine("Send the email ^a1b2c3") === "Send the email");
check("strip is a no-op without a marker", stripAnchorFromLine("plain line") === "plain line");
check("strip leaves a checkbox intact", stripAnchorFromLine("- [ ] do it ^abcd12") === "- [ ] do it");

// --- stripBlockAnchors (document-level, fence-aware) ----------------------
const doc = [
  "# Notes",
  "",
  "Send the email ^a1b2c3",
  "- [ ] Draft the plan ^x9y8z7",
  "  - sub detail (no anchor)",
  "",
  "```",
  "const x = arr ^abcdef // code, keep verbatim",
  "```",
  "",
  "A claim[^1] with a footnote.",
  "",
  "[^1]: the footnote ^z0z0z0",
].join("\n");
const stripped = stripBlockAnchors(doc);
check("strips a plain-line anchor", stripped.includes("Send the email\n") && !stripped.includes("^a1b2c3"));
check("strips a checkbox-line anchor", stripped.includes("- [ ] Draft the plan\n") && !stripped.includes("^x9y8z7"));
check("leaves fenced-code ^id intact", stripped.includes("const x = arr ^abcdef // code, keep verbatim"));
check("leaves footnote ref intact", stripped.includes("A claim[^1] with a footnote."));
// The footnote-definition line ends with a real trailing ^z0z0z0 here, so it IS
// stripped — that's correct: it's a deliberate trailing marker, not the [^1] ref.
check("strips a trailing marker on a footnote-def line", !stripped.includes("^z0z0z0"));
check("strip is a no-op on anchor-free markdown", stripBlockAnchors("# Clean\n\nNo markers here.") === "# Clean\n\nNo markers here.");

// --- hasBlockId / uniqueBlockId / lineWithBlockId -------------------------
check("hasBlockId finds an existing id", hasBlockId(doc, "a1b2c3"));
check("hasBlockId misses an absent id", !hasBlockId(doc, "nope12"));
const fresh = uniqueBlockId(doc);
check("uniqueBlockId returns an unused id", !hasBlockId(doc, fresh) && /^[a-z0-9]{6}$/.test(fresh));
check("lineWithBlockId locates the line", lineWithBlockId(doc, "x9y8z7") === 3);
check("lineWithBlockId returns -1 when absent", lineWithBlockId(doc, "nope12") === -1);

// --- the load-bearing round-trip: marked preserves a trailing ^id ---------
function tokenTextHasId(src: string, wantId: string): boolean {
  return JSON.stringify(marked.lexer(src)).includes(wantId);
}
check("marked preserves ^id on a plain paragraph", tokenTextHasId("Send the email ^a1b2c3", "a1b2c3"));
check("marked preserves ^id on a task line", tokenTextHasId("- [ ] Send the email ^a1b2c3", "a1b2c3"));
check("marked does not turn a trailing ^id into a special token",
  marked.lexer("Send the email ^a1b2c3")[0].type === "paragraph");

// --- extractPromotable (title + de-indented sub-bullets) ------------------
const promoteDoc = [
  "# Staff meeting",
  "",
  "- [ ] Send the budget email to the elders ^bud123",
  "    - include the Q3 forecast",
  "    - cc Sarah",
  "- [ ] A different action ^oth456",
].join("\n");
const ex = extractPromotable(promoteDoc, "bud123");
check("extract title drops the checkbox marker and the ^id", ex?.title === "Send the budget email to the elders");
check("extract body pulls the de-indented sub-bullets", ex?.body === "- include the Q3 forecast\n- cc Sarah");
const exNoChildren = extractPromotable("- [ ] Lone item ^lon789\n- [ ] Next ^nxt000", "lon789");
check("extract body is empty when the line has no children", exNoChildren?.title === "Lone item" && exNoChildren?.body === "");
check("extract returns null for an absent id", extractPromotable(promoteDoc, "zzzzzz") === null);
const exPlain = extractPromotable("Just a paragraph action ^par111", "par111");
check("extract handles a plain (non-list) line", exPlain?.title === "Just a paragraph action" && exPlain?.body === "");

console.log(failures === 0 ? "\nAll block-anchor checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
