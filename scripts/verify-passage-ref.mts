// Passage resolver + canon verification (ADR-143, slice 1). Pure — no DB. Covers
// the canon integrity (66 books / 31,102 verses / pinned KJV counts), the
// ref→integer encoding and round-trip, parsePassageRef across the reference
// forms + canon validation (bad chapter/verse → null), the versification pin
// (3 John has 14 verses, not 15), book-alias resolution, the ledgr://passage/
// URI grammar, markdown collection, and the human formatter.
// Run: npx tsx scripts/verify-passage-ref.mts
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { CANON, TOTAL_VERSES, findBook, verseCount, chapterCount, bookByNum } =
  await import("../src/lib/passages/canon");
const {
  encodeRef,
  decodeRef,
  parsePassageRef,
  formatPassageRef,
  passageUri,
  parsePassageUri,
  passageToMarkdown,
  collectPassageRefsFromMarkdown,
  contains,
  overlaps,
} = await import("../src/lib/passages/ref");

console.log("\n# Canon integrity");
{
  check("66 books", CANON.length === 66, `${CANON.length}`);
  check("nums are 1..66 contiguous", CANON.every((b, i) => b.num === i + 1));
  check("1,189 chapters total", CANON.reduce((s, b) => s + b.verses.length, 0) === 1189);
  check("31,102 verses total (KJV)", TOTAL_VERSES === 31102, `${TOTAL_VERSES}`);
  const ps = findBook("Psalms")!;
  check("Psalms has 150 chapters", chapterCount(ps) === 150);
  check("Psalm 119 has 176 verses", verseCount(ps, 119) === 176);
  check("Psalm 117 has 2 verses", verseCount(ps, 117) === 2);
  const rom = findBook("Romans")!;
  check("Romans has 16 chapters", chapterCount(rom) === 16);
  check("Romans has no chapter 17 (verseCount = 0)", verseCount(rom, 17) === 0);
}

console.log("\n# Book aliases");
{
  check("ps / psalm / psalms → Psalms", ["ps", "psalm", "psalms"].every((a) => findBook(a)?.num === 19));
  check("1cor / 1 cor / first corinthians → 1 Corinthians", ["1cor", "1 cor", "First Corinthians", "I Cor", "1st Cor"].every((a) => findBook(a)?.num === 46));
  check("song of songs → Song of Solomon", findBook("song of songs")?.num === 22);
  check("Rom. (trailing dot) → Romans", findBook("Rom.")?.num === 45);
  check("unknown book → null", findBook("Nephi") === null);
}

console.log("\n# Encoding");
{
  check("Rom 8:5 encodes to 45_008_005", encodeRef(45, 8, 5) === 45_008_005);
  const d = decodeRef(45_008_005);
  check("decode round-trips", d.book === 45 && d.chapter === 8 && d.verse === 5);
}

console.log("\n# parsePassageRef");
{
  const eq = (input: string, s: number, e: number) => {
    const r = parsePassageRef(input);
    return !!r && r.startRef === s && r.endRef === e;
  };
  check('"Rom 8:5"', eq("Rom 8:5", 45_008_005, 45_008_005));
  check('"Romans 8.5" (dot separator)', eq("Romans 8.5", 45_008_005, 45_008_005));
  check('"Rom. 8:5-9" (same-chapter range)', eq("Rom. 8:5-9", 45_008_005, 45_008_009));
  check('"Rom 8:5–9" (en-dash)', eq("Rom 8:5–9", 45_008_005, 45_008_009));
  check('"1 Cor 13:4-7"', eq("1 Cor 13:4-7", 46_013_004, 46_013_007));
  check('"John 3:16"', eq("John 3:16", 43_003_016, 43_003_016));
  check('"Psalm 23" (whole chapter → 1..6)', eq("Psalm 23", 19_023_001, 19_023_006));
  check('"Rom 8" (whole chapter → 1..39)', eq("Rom 8", 45_008_001, 45_008_039));
  check('"Rom 8:5-9:2" (cross-chapter)', eq("Rom 8:5-9:2", 45_008_005, 45_009_002));
  check('"Rom 8-9" (whole chapter range)', eq("Rom 8-9", 45_008_001, 45_009_033));
  check('"Romans" (whole book)', eq("Romans", 45_001_001, 45_016_027));
  check('"1 John 4:8"', eq("1 John 4:8", 62_004_008, 62_004_008));
  // Single-chapter books: a bare number is a VERSE in chapter 1, not a chapter.
  check('"3 John 14" (single-chapter → 1:14)', eq("3 John 14", 64_001_014, 64_001_014));
  check('"Jude 3" (single-chapter → 1:3)', eq("Jude 3", 65_001_003, 65_001_003));
  check('"Jude 3-4" (single-chapter range → 1:3–4)', eq("Jude 3-4", 65_001_003, 65_001_004));
  check('"Obadiah 21" (single-chapter → 1:21)', eq("Obadiah 21", 31_001_021, 31_001_021));
  check('"Philemon" (whole single-chapter book)', eq("Philemon", 57_001_001, 57_001_025));
}

console.log("\n# Validation & versification pin");
{
  check('"Rom 17:1" → null (no ch. 17)', parsePassageRef("Rom 17:1") === null);
  check('"Rom 8:99" → null (verse out of range)', parsePassageRef("Rom 8:99") === null);
  check('"3 John 15" → null (KJV has 14 verses)', parsePassageRef("3 John 15") === null);
  check('"3 John 14" → ok (last verse)', !!parsePassageRef("3 John 14"));
  check('"Xyz 1:1" → null (unknown book)', parsePassageRef("Xyz 1:1") === null);
  check('"" → null', parsePassageRef("") === null);
  check("descending range → null", parsePassageRef("Rom 8:9-5") === null);
}

console.log("\n# URI grammar");
{
  check("single-verse URI has no dash", passageUri(45_008_005, 45_008_005) === "ledgr://passage/45008005");
  check("range URI is start-end", passageUri(45_008_005, 45_008_009) === "ledgr://passage/45008005-45008009");
  const p = parsePassageUri("ledgr://passage/45008005-45008009");
  check("parse round-trips range", !!p && p.startRef === 45_008_005 && p.endRef === 45_008_009);
  const s = parsePassageUri("ledgr://passage/45008005");
  check("parse single fills endRef", !!s && s.startRef === 45_008_005 && s.endRef === 45_008_005);
  check("item URI is not a passage URI", parsePassageUri("ledgr://item/abc") === null);
  check("garbage after prefix → null", parsePassageUri("ledgr://passage/nope") === null);
}

console.log("\n# Markdown collection");
{
  const body = [
    passageToMarkdown(45_008_005, 45_008_009),
    "some prose [@A note](ledgr://item/11111111-1111-1111-1111-111111111111) more",
    passageToMarkdown(43_003_016, 43_003_016),
    passageToMarkdown(45_008_005, 45_008_009), // duplicate
  ].join("\n");
  const refs = collectPassageRefsFromMarkdown(body);
  check("collects 2 distinct passages (dedup, ignores item mention)", refs.length === 2, `${refs.length}`);
  check("first-seen order preserved", refs[0].startRef === 45_008_005 && refs[1].startRef === 43_003_016);
  check("empty body → []", collectPassageRefsFromMarkdown("").length === 0);
}

console.log("\n# formatPassageRef + markdown round-trip");
{
  check("single verse", formatPassageRef(45_008_005, 45_008_005) === "Romans 8:5");
  check("same-chapter range (en-dash)", formatPassageRef(45_008_005, 45_008_009) === "Romans 8:5–9");
  check("cross-chapter range", formatPassageRef(45_008_005, 45_009_002) === "Romans 8:5–9:2");
  check("whole single chapter", formatPassageRef(45_008_001, 45_008_039) === "Romans 8");
  check("whole chapter range", formatPassageRef(45_008_001, 45_009_033) === "Romans 8–9");
  check("whole book", formatPassageRef(45_001_001, 45_016_027) === "Romans");
  check("single-chapter book verse (no chapter shown)", formatPassageRef(65_001_003, 65_001_003) === "Jude 3");
  check("single-chapter book range", formatPassageRef(65_001_003, 65_001_004) === "Jude 3–4");
  check("single-chapter whole book", formatPassageRef(57_001_001, 57_001_025) === "Philemon");
  // The markdown a picker inserts parses back to the same interval via its URI.
  const md = passageToMarkdown(45_008_005, 45_008_009);
  const uriMatch = /\((ledgr:\/\/passage\/[^)]+)\)/.exec(md);
  const back = uriMatch ? parsePassageUri(uriMatch[1]) : null;
  check("passageToMarkdown href round-trips", !!back && back.startRef === 45_008_005 && back.endRef === 45_008_009);
}

console.log("\n# Interval helpers");
{
  const rom8_5_9 = { startRef: 45_008_005, endRef: 45_008_009 };
  check("contains an inner verse", contains(rom8_5_9, 45_008_007));
  check("excludes an outer verse", !contains(rom8_5_9, 45_008_010));
  check("overlaps a touching range", overlaps(rom8_5_9, { startRef: 45_008_009, endRef: 45_008_012 }));
  check("no overlap when disjoint", !overlaps(rom8_5_9, { startRef: 45_008_010, endRef: 45_008_012 }));
}

console.log("\n# Editor tokenizer round-trip (mirrors the regex in extensions.ts)");
{
  // The exact inline tokenizer the LedgrPassage node uses to reclaim its links
  // on parse. Kept in sync with src/components/markdown-editor/extensions.ts.
  const TOKENIZER = /^\[((?:\\.|[^\]\\])*)\]\(ledgr:\/\/passage\/(\d+(?:-\d+)?)\)/;
  const md = passageToMarkdown(45_008_005, 45_008_009);
  const m = TOKENIZER.exec(md);
  check("tokenizer matches passageToMarkdown output", !!m);
  check("tokenizer captures the label", m?.[1] === "Romans 8:5–9");
  const slug = m?.[2] ?? "";
  const back = parsePassageUri(`ledgr://passage/${slug}`);
  check("tokenizer slug parses back to the interval", !!back && back.startRef === 45_008_005 && back.endRef === 45_008_009);
  // A single-verse link (no dash) also tokenizes.
  const single = passageToMarkdown(43_003_016, 43_003_016);
  check("single-verse link tokenizes", TOKENIZER.test(single));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (bookByNum(45)?.name !== "Romans") { console.log("FAIL  bookByNum sanity"); failures += 1; }
process.exit(failures === 0 ? 0 : 1);
