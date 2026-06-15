// Verifies the editor's image + table markdown contract (the inline-image
// paste/drop re-wire and GFM tables, ADR-040 follow-on). Like
// verify-tiptap-markdown.mts, this proves the pure logic the Tiptap hooks
// delegate to — plus a real round-trip through `marked` (the parser
// @tiptap/markdown uses) so the table grid and image link are shown to survive
// encode → decode. The full in-editor serialize/parse is the in-browser check.
// Run: npx tsx scripts/verify-editor-media.mts
import { marked } from "marked";

const { imageToMarkdown, imageAttrsFromToken } = await import(
  "../src/lib/editor/image-markdown"
);
const { tableToGfm, escapeTableCell } = await import(
  "../src/lib/editor/table-markdown"
);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- image: attrs → markdown ----------------------------------------------
check(
  "image emits ![alt](src)",
  imageToMarkdown({ src: "https://cdn/x.png", alt: "A shot" }) ===
    "![A shot](https://cdn/x.png)"
);
check(
  "image with no alt is still valid",
  imageToMarkdown({ src: "https://cdn/x.png" }) === "![](https://cdn/x.png)"
);
check(
  "image escapes brackets in alt",
  imageToMarkdown({ src: "u", alt: "see [1]" }) === "![see \\[1\\]](u)"
);
check(
  "image renders a title when present",
  imageToMarkdown({ src: "u", alt: "a", title: "Cap" }) === '![a](u "Cap")'
);

// --- image: real marked token → attrs → markdown round-trip ----------------
{
  const src = "![a screenshot](https://cdn.example.com/path/img.png)";
  const para = marked.lexer(src)[0] as { tokens: { type: string }[] };
  const imgToken = para.tokens.find((t) => t.type === "image") as Parameters<
    typeof imageAttrsFromToken
  >[0];
  const attrs = imageAttrsFromToken(imgToken);
  check("image token decodes src", attrs.src === "https://cdn.example.com/path/img.png", attrs.src);
  check("image token decodes alt", attrs.alt === "a screenshot", attrs.alt);
  check("image round-trips to the same markdown", imageToMarkdown(attrs) === src, imageToMarkdown(attrs));
}

// --- table cell escaping ---------------------------------------------------
check("cell escapes a pipe", escapeTableCell("a|b") === "a\\|b");
check("cell escapes a backslash", escapeTableCell("a\\b") === "a\\\\b");
check("cell collapses a newline to a space", escapeTableCell("a\nb") === "a b");
check("cell trims and collapses whitespace", escapeTableCell("  a   b  ") === "a b");

// --- table: rows → GFM -----------------------------------------------------
{
  const gfm = tableToGfm([
    ["Name", "Role"],
    ["Roger", "Elder"],
  ]);
  check(
    "table emits header + separator + body",
    gfm === "| Name | Role |\n| --- | --- |\n| Roger | Elder |",
    gfm.replace(/\n/g, "\\n")
  );
}
check(
  "ragged rows pad to the widest",
  tableToGfm([["a", "b", "c"], ["x"]]) ===
    "| a | b | c |\n| --- | --- | --- |\n| x |  |  |"
);
check("a header-only table still renders a separator", tableToGfm([["only"]]) === "| only |\n| --- |");

// --- table: real marked round-trip (the grid survives encode → decode) -----
{
  // Mirror LedgrTable.parseMarkdown's text extraction (plain-text cells), then
  // re-emit with tableToGfm and re-lex; the header/body cell text must match.
  const original = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n";
  const token = marked.lexer(original)[0] as {
    type: string;
    header: { text: string }[];
    rows: { text: string }[][];
  };
  check("marked tokenizes it as a table", token.type === "table");
  const rows = [
    token.header.map((c) => c.text),
    ...token.rows.map((r) => r.map((c) => c.text)),
  ];
  const reemitted = tableToGfm(rows);
  const round = marked.lexer(reemitted + "\n")[0] as typeof token;
  check(
    "table header survives the round-trip",
    JSON.stringify(round.header.map((c) => c.text)) ===
      JSON.stringify(["A", "B"])
  );
  check(
    "table body survives the round-trip",
    JSON.stringify(round.rows.map((r) => r.map((c) => c.text))) ===
      JSON.stringify([["1", "2"], ["3", "4"]])
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
