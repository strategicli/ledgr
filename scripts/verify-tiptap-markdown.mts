// Verifies the bespoke markdown contract the Tiptap editor delegates to: the
// color/highlight encode↔decode round-trip (colors.ts) and the mention link
// (mention-markdown.ts). Pure functions, no DB, no browser.
//
// What this does NOT cover: the full in-editor serialize/parse through Tiptap
// (StarterKit + Markdown + the extensions) and the @-mention popup — those are
// the in-browser check on /scratch/editor (and the real canvas). This proves
// the logic those hooks call is correct.
// Run: npx tsx scripts/verify-tiptap-markdown.mts

const {
  BLOCKNOTE_COLORS,
  textColorTag,
  highlightTag,
  textColorName,
  highlightColorName,
} = await import("../src/lib/colors");
const { mentionToMarkdown, mentionItemId, mentionTitleFromLabel } =
  await import("../src/lib/editor/mention-markdown");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const colors = Object.keys(BLOCKNOTE_COLORS) as (keyof typeof BLOCKNOTE_COLORS)[];

// --- color marks: encode → decode round-trip (both channels) ---------------
for (const c of colors) {
  const open = textColorTag(c).open; // <span style="color:#hex">
  const style = open.replace(/^<span style="/, "").replace(/">$/, "");
  check(`textColor ${c} decodes from its own style`, textColorName(style) === c, style);

  const hl = highlightTag(c).open; // <mark class="hl-c" style="background-color:#hex">
  const cls = hl.match(/class="([^"]+)"/)?.[1] ?? null;
  const hlStyle = hl.match(/style="([^"]+)"/)?.[1] ?? null;
  check(`highlight ${c} decodes from class+style`, highlightColorName(cls, hlStyle) === c);
  check(`highlight ${c} decodes from class alone`, highlightColorName(cls, null) === c);
  check(`highlight ${c} decodes from style alone`, highlightColorName(null, hlStyle) === c);
}

// --- non-matches degrade to null, never a wrong color ----------------------
check("foreign text color → null", textColorName("color:#123456") === null);
check("no class, no style → null", highlightColorName(null, null) === null);
check("foreign highlight bg → null", highlightColorName("hl-chartreuse", "background-color:#123456") === null);

// --- mention link: encode → decode -----------------------------------------
const id = "9f8c2b14-0000-4abc-8def-112233445566";
const md = mentionToMarkdown(id, "Elder Meeting");
check("mention emits the ledgr link", md === `[@Elder Meeting](ledgr://item/${id})`, md);
check("mention id extracts from its href", mentionItemId(`ledgr://item/${id}`) === id);
check("label strips the leading @", mentionTitleFromLabel("@Elder Meeting") === "Elder Meeting");

const brackety = mentionToMarkdown(id, "Plan [draft]");
check("mention escapes brackets in the title", brackety.includes("\\[draft\\]"), brackety);
check("mention id still extracts with an escaped title", mentionItemId(`ledgr://item/${id}`) === id);

// --- non-mentions are left alone -------------------------------------------
check("ordinary https link is not a mention", mentionItemId("https://example.com") === null);
check("empty/garbage href → null", mentionItemId("ledgr://item/") === null && mentionItemId(undefined) === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
