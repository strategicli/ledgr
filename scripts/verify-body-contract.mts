// M3 / ADR-040 verification: the canonical body contract end to end, as pure
// functions (no DB, no browser).
//  - body.ts: the { format, text } shape helpers + tolerant bodyMarkdown
//  - mention-markdown.ts: scanning ledgr://item/<id> out of markdown
//  - markdown-render.ts: the FTS text strip (drops markup/URIs/hexes, keeps prose)
//  - body-text.ts: extractBodyText over the new body shape
//   npx tsx scripts/verify-body-contract.mts
import { makeMarkdownBody, isItemBody, bodyMarkdown, MARKDOWN_FORMAT } from "../src/lib/body";
import {
  mentionToMarkdown,
  collectMentionIdsFromMarkdown,
} from "../src/lib/editor/mention-markdown";
import { markdownToText } from "../src/lib/markdown-render";
import { extractBodyText } from "../src/lib/body-text";
import { textColorTag } from "../src/lib/colors";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- the { format, text } shape --------------------------------------------
const b = makeMarkdownBody("hello");
check("makeMarkdownBody tags markdown", b.format === MARKDOWN_FORMAT && b.text === "hello");
check("isItemBody true for { format, text }", isItemBody(b));
check("isItemBody false for an array (pre-cutover)", !isItemBody([{ type: "paragraph" }]));
check("isItemBody false for null / string / partials", !isItemBody(null) && !isItemBody("x") && !isItemBody({ format: "markdown" }) && !isItemBody({ text: "x" }));

// --- bodyMarkdown is tolerant ----------------------------------------------
check("bodyMarkdown extracts text", bodyMarkdown(b) === "hello");
check("bodyMarkdown null → ''", bodyMarkdown(null) === "");
check("bodyMarkdown bare string → itself", bodyMarkdown("raw md") === "raw md");
check("bodyMarkdown foreign shape (array) → ''", bodyMarkdown([{ type: "paragraph" }]) === "");

// --- mention scanning out of markdown --------------------------------------
const id1 = "9f8c2b14-0000-4abc-8def-112233445566";
const id2 = "11112222-3333-4444-5555-666677778888";
const md = `Prep ${mentionToMarkdown(id1, "Roger")} and ${mentionToMarkdown(id2, "Elders")}, again ${mentionToMarkdown(id1, "Roger")}.`;
const ids = collectMentionIdsFromMarkdown(md);
check("finds both mention ids", ids.includes(id1) && ids.includes(id2));
check("dedups a repeated mention, first-seen order", ids.length === 2 && ids[0] === id1 && ids[1] === id2, ids.join(","));
check("ignores a plain https link", collectMentionIdsFromMarkdown("[x](https://example.com)").length === 0);
check("skips an empty ledgr id", collectMentionIdsFromMarkdown("see ledgr://item/ here").length === 0);
check("empty markdown → no ids", collectMentionIdsFromMarkdown("").length === 0);

// --- FTS text strip: keep prose, drop markup / URIs / hexes ----------------
const richMd = [
  "# Sermon Notes",
  "",
  `A ${textColorTag("red").open}red phrase${textColorTag("red").close} and ${mentionToMarkdown(id1, "Roger")}.`,
  "",
  "- point one",
  "- point two",
  "",
  "```",
  "const x = 1;",
  "```",
].join("\n");
const text = markdownToText(richMd);
check("FTS keeps heading + prose words", text.includes("Sermon Notes") && text.includes("red phrase"));
check("FTS keeps the mention label", text.includes("@Roger"));
check("FTS drops the ledgr:// URI", !text.includes("ledgr://"));
check("FTS drops the color hex", !text.includes("e03e3e") && !text.includes("#"));
check("FTS keeps list items + code text", text.includes("point one") && text.includes("const x = 1;"));
check("FTS has no angle-bracket markup", !text.includes("<") && !text.includes(">"));

// --- extractBodyText over the body shape -----------------------------------
check("extractBodyText of a markdown body strips to words", extractBodyText(makeMarkdownBody("## Hi\n\n**bold** word")) === "Hi bold word");
check("extractBodyText null body → null", extractBodyText(null) === null);
check("extractBodyText empty text → null", extractBodyText(makeMarkdownBody("")) === null);
check("extractBodyText whitespace-only → null", extractBodyText(makeMarkdownBody("   \n\n")) === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
