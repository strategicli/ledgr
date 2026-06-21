// Canvas tabs (ADR-094) — pure verification of the body<->tabs codec. No DB.
// Run: npx tsx scripts/verify-canvas-tabs.mts
const { parseTabs, serializeTabs, flattenTabs, hasTabs, sanitizeTabTitle } = await import(
  "../src/lib/editor/canvas-tabs"
);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- untabbed bodies are pass-through (back-compat) ---
check("hasTabs false on plain text", hasTabs("# Hello\n\nsome notes") === false);
check("parseTabs null on plain text", parseTabs("# Hello\n\nsome notes") === null);
check("parseTabs null on empty", parseTabs("") === null);
check("flattenTabs passes plain text unchanged", flattenTabs("# Hi\n\nx") === "# Hi\n\nx");

// --- a tabbed body parses into its sections ---
const body = [
  "<!-- tab: Lyrics v1 -->",
  "Verse one",
  "",
  "<!-- tab: Lyrics v2 -->",
  "Verse two",
  "",
  "<!-- tab: Notes -->",
  "- idea",
].join("\n");
check("hasTabs true on tabbed body", hasTabs(body) === true);
const tabs = parseTabs(body);
check("parses 3 tabs", tabs?.length === 3, String(tabs?.length));
check("tab 0 title + body", tabs?.[0].title === "Lyrics v1" && tabs?.[0].body === "Verse one");
check("tab 1 title + body", tabs?.[1].title === "Lyrics v2" && tabs?.[1].body === "Verse two");
check("tab 2 title + body", tabs?.[2].title === "Notes" && tabs?.[2].body === "- idea");

// --- round-trip: parse -> serialize -> parse is stable ---
const round = parseTabs(serializeTabs(tabs!));
check(
  "round-trip preserves titles + bodies",
  JSON.stringify(round) === JSON.stringify(tabs)
);

// --- content before the first marker becomes a leading untitled tab ---
const withPreamble = "loose intro\n\n<!-- tab: A -->\nalpha";
const pt = parseTabs(withPreamble);
check("preamble becomes a leading untitled tab", pt?.length === 2 && pt?.[0].title === "" && pt?.[0].body === "loose intro");
check("preamble keeps the named tab", pt?.[1].title === "A" && pt?.[1].body === "alpha");

// --- flatten turns markers into ## headings (readers) ---
const flat = flattenTabs(body);
check("flatten emits ## headings", flat.includes("## Lyrics v1") && flat.includes("## Notes"));
check("flatten drops the comment markers", !flat.includes("<!-- tab:"));
check("flatten keeps content", flat.includes("Verse one") && flat.includes("- idea"));
check("flatten: untitled section emits no heading", flattenTabs("<!-- tab:  -->\njust text").trim() === "just text");

// --- title sanitization keeps a marker line valid/single-line ---
check("sanitize strips newlines", sanitizeTabTitle("a\nb") === "a b");
check("sanitize strips the comment terminator", sanitizeTabTitle("x --> y") === "x y");
const tricky = serializeTabs([{ title: "we\nird -->", body: "z" }]);
check("serialize stays single-line per marker", parseTabs(tricky)?.length === 1 && parseTabs(tricky)?.[0].body === "z");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
