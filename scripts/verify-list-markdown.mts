// Empty-list-item verification (Brandon, 2026-08-01). Pure — no DB, no env.
// Covers spaceEmptyListItems and the render chain it plugs into: an empty
// bullet under a paragraph must render as a bullet, never as a setext heading.
// Run: npx tsx scripts/verify-list-markdown.mts
import {
  hydrateEmptyListItems,
  spaceEmptyListItems,
  stripSentinelText,
} from "../src/lib/editor/list-markdown";
import { markdownToHtml } from "../src/lib/markdown-render";
import { marked } from "marked";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- the ambiguous shape gets a blank line ---------------------------------
check(
  "empty bullet nested under a paragraph is separated",
  spaceEmptyListItems("- A\n    - \n    - B\n") === "- A\n\n    - \n    - B\n"
);
check(
  "empty bullet under a plain paragraph is separated",
  spaceEmptyListItems("Some text\n- \n") === "Some text\n\n- \n"
);
check(
  "a bare `-` (no trailing space) counts too",
  spaceEmptyListItems("- A\n    -\n") === "- A\n\n    -\n"
);
check(
  "empty ordered item is separated",
  spaceEmptyListItems("- A\n    1. \n") === "- A\n\n    1. \n"
);

// --- shapes that already parse right are left alone ------------------------
check(
  "empty item at the same level is untouched (stays tight)",
  spaceEmptyListItems("- A\n- \n- B\n") === "- A\n- \n- B\n"
);
check(
  "empty item shallower than the line above is untouched",
  spaceEmptyListItems("- A\n    - B\n- \n") === "- A\n    - B\n- \n"
);
check(
  "an empty item after a blank line is untouched",
  spaceEmptyListItems("- A\n\n    - \n") === "- A\n\n    - \n"
);
check(
  "a non-empty nested item is untouched",
  spaceEmptyListItems("- A\n    - B\n") === "- A\n    - B\n"
);
check(
  "fenced code is passed through",
  spaceEmptyListItems("```\n- A\n    - \n```\n") === "```\n- A\n    - \n```\n"
);
check("no newline in, same string out", spaceEmptyListItems("- ") === "- ");

// --- the bug this exists for: rendering ------------------------------------
// Brandon's sermon shape. Without the fix markdown-it reads the `- ` lines as a
// setext underline and the sentence above them becomes an <h2>.
const sermon =
  "- If you missed it last week, here's the gist:\n" +
  "    - We can be totally focused on this world.\n" +
  "        - \n" +
  "        - \n" +
  "    - OR we can be focused on eternal things.\n";
const html = markdownToHtml(sermon);
check("no phantom heading in the rendered body", !/<h[1-6]/.test(html), html.slice(0, 120));
check(
  "both sentences still render as list text",
  html.includes("We can be totally focused on this world.") &&
    html.includes("OR we can be focused on eternal things.")
);

// --- the editor's own parser (marked) --------------------------------------
// The editor is stricter than markdown-it: without the sentinel, an empty item
// that opens a nested list drops out of the list entirely and lands as a
// literal "- " paragraph. This is the editor half of the same bug.
const editorHtml = marked.parse(hydrateEmptyListItems(sermon)) as string;
check("editor parse: no phantom heading", !/<h[1-6]/.test(editorHtml));
check(
  "editor parse: the empty bullets are list items, not stray text",
  (editorHtml.match(/<li>/g) ?? []).length === 5 && !/<p>\s*-/.test(editorHtml),
  editorHtml.replace(/\n/g, "")
);
check(
  "sentinels never survive into the document",
  !JSON.stringify(
    stripSentinelText({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "​" }] },
        { type: "paragraph", content: [{ type: "text", text: "keep​ me" }] },
      ],
    })
  ).includes("​")
);
check(
  "stripping leaves real text alone",
  JSON.stringify(
    stripSentinelText({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "keep​ me" }] }],
    })
  ).includes("keep me")
);

// --- round-trip stability --------------------------------------------------
// The editor re-serializes tight markdown; running the pass twice must not keep
// adding blank lines (that would churn saves on every open).
const once = spaceEmptyListItems("- A\n    - \n    - B\n");
check("idempotent", spaceEmptyListItems(once) === once);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
