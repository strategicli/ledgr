// The Bible canon as tiny static reference data (ADR-143). NOT verse items and
// NOT a table: a fixed, shared, read-only ontology (identical for every owner),
// so it lives in code, not in the owner-scoped `items` table. This is enough to
// (a) parse a reference, (b) validate it ("does Romans have a ch. 17?"), and
// (c) generate the browse UI — a book list plus a verses-per-chapter count array
// per book. A few KB total; packages trivially for the local-first build.
//
// Canon is PINNED (Tyler's review pt 5): 66-book Protestant order, English
// (KJV-style) versification. The verse counts below are the classic KJV table,
// so the integer encoding in ref.ts never shifts under us. Translation-specific
// differences (Hebrew psalm superscriptions, the 3 John 14/15 split) normalize
// against this fixed grid at parse time, not by editing these numbers.
//
// Pure data + pure lookups only: no DB, no markdown, no owner scope. Safe to
// import from both client (browse UI, @/ref picker) and server (ref resolver).

export type CanonBook = {
  // 1-based canonical order (Genesis = 1 … Revelation = 66). This is the `book`
  // factor in the ref integer (book·1_000_000), so it must never be reordered.
  num: number;
  name: string; // canonical display name ("1 Corinthians", "Song of Solomon")
  // Match tokens (all lowercased, no trailing dot): the canonical name, common
  // abbreviations, and OSIS-ish short forms. Leading ordinals are normalized to
  // a digit ("first"/"i"/"1st" → "1") before lookup, so only the "1 cor" shape
  // is listed here, not "i cor"/"first cor".
  aliases: string[];
  // verses[c] = the verse count of chapter (c+1). Length is the chapter count.
  verses: number[];
};

// KJV verses-per-chapter, in canonical order. Row length = the book's chapter
// count. Transcribed from the standard KJV versification table.
export const CANON: CanonBook[] = [
  { num: 1, name: "Genesis", aliases: ["genesis", "gen", "ge", "gn"], verses: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26] },
  { num: 2, name: "Exodus", aliases: ["exodus", "exo", "exod", "ex"], verses: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38] },
  { num: 3, name: "Leviticus", aliases: ["leviticus", "lev", "le", "lv"], verses: [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34] },
  { num: 4, name: "Numbers", aliases: ["numbers", "num", "nu", "nm", "nb"], verses: [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13] },
  { num: 5, name: "Deuteronomy", aliases: ["deuteronomy", "deut", "dt", "de"], verses: [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12] },
  { num: 6, name: "Joshua", aliases: ["joshua", "josh", "jos", "jsh"], verses: [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33] },
  { num: 7, name: "Judges", aliases: ["judges", "judg", "jdg", "jg", "jdgs"], verses: [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25] },
  { num: 8, name: "Ruth", aliases: ["ruth", "rut", "rth", "ru"], verses: [22,23,18,22] },
  { num: 9, name: "1 Samuel", aliases: ["1 samuel", "1 sam", "1sam", "1 sa", "1sa", "1 sm", "1s"], verses: [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13] },
  { num: 10, name: "2 Samuel", aliases: ["2 samuel", "2 sam", "2sam", "2 sa", "2sa", "2 sm", "2s"], verses: [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25] },
  { num: 11, name: "1 Kings", aliases: ["1 kings", "1 kgs", "1kgs", "1 ki", "1ki", "1 kin", "1k"], verses: [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53] },
  { num: 12, name: "2 Kings", aliases: ["2 kings", "2 kgs", "2kgs", "2 ki", "2ki", "2 kin", "2k"], verses: [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30] },
  { num: 13, name: "1 Chronicles", aliases: ["1 chronicles", "1 chron", "1 chr", "1chr", "1 ch", "1ch"], verses: [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30] },
  { num: 14, name: "2 Chronicles", aliases: ["2 chronicles", "2 chron", "2 chr", "2chr", "2 ch", "2ch"], verses: [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23] },
  { num: 15, name: "Ezra", aliases: ["ezra", "ezr", "ez"], verses: [11,70,13,24,17,22,28,36,15,44] },
  { num: 16, name: "Nehemiah", aliases: ["nehemiah", "neh", "ne"], verses: [11,20,32,23,19,19,73,18,38,39,36,47,31] },
  { num: 17, name: "Esther", aliases: ["esther", "esth", "est", "es"], verses: [22,23,15,17,14,14,10,17,32,3] },
  { num: 18, name: "Job", aliases: ["job", "jb"], verses: [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17] },
  { num: 19, name: "Psalms", aliases: ["psalms", "psalm", "psa", "ps", "pss", "psm"], verses: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6] },
  { num: 20, name: "Proverbs", aliases: ["proverbs", "prov", "prv", "pr"], verses: [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31] },
  { num: 21, name: "Ecclesiastes", aliases: ["ecclesiastes", "eccl", "ecc", "ec", "qoh"], verses: [18,26,22,16,20,12,29,17,18,20,10,14] },
  { num: 22, name: "Song of Solomon", aliases: ["song of solomon", "song of songs", "song", "sos", "sng", "so", "canticles", "cant"], verses: [17,17,11,16,16,13,13,14] },
  { num: 23, name: "Isaiah", aliases: ["isaiah", "isa", "is"], verses: [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24] },
  { num: 24, name: "Jeremiah", aliases: ["jeremiah", "jer", "je", "jr"], verses: [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34] },
  { num: 25, name: "Lamentations", aliases: ["lamentations", "lam", "la"], verses: [22,22,66,22,22] },
  { num: 26, name: "Ezekiel", aliases: ["ezekiel", "ezek", "eze", "ezk"], verses: [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35] },
  { num: 27, name: "Daniel", aliases: ["daniel", "dan", "da", "dn"], verses: [21,49,30,37,31,28,28,27,27,21,45,13] },
  { num: 28, name: "Hosea", aliases: ["hosea", "hos", "ho"], verses: [11,23,5,19,15,11,16,14,17,15,12,14,16,9] },
  { num: 29, name: "Joel", aliases: ["joel", "joe", "jl"], verses: [20,32,21] },
  { num: 30, name: "Amos", aliases: ["amos", "amo", "am"], verses: [15,16,15,13,27,14,17,14,15] },
  { num: 31, name: "Obadiah", aliases: ["obadiah", "obad", "oba", "ob"], verses: [21] },
  { num: 32, name: "Jonah", aliases: ["jonah", "jon", "jnh"], verses: [17,10,10,11] },
  { num: 33, name: "Micah", aliases: ["micah", "mic", "mc"], verses: [16,13,12,13,15,16,20] },
  { num: 34, name: "Nahum", aliases: ["nahum", "nah", "na"], verses: [15,13,19] },
  { num: 35, name: "Habakkuk", aliases: ["habakkuk", "hab", "hb"], verses: [17,20,19] },
  { num: 36, name: "Zephaniah", aliases: ["zephaniah", "zeph", "zep", "zp"], verses: [18,15,20] },
  { num: 37, name: "Haggai", aliases: ["haggai", "hag", "hg"], verses: [15,23] },
  { num: 38, name: "Zechariah", aliases: ["zechariah", "zech", "zec", "zc"], verses: [21,13,10,14,11,15,14,23,17,12,17,14,9,21] },
  { num: 39, name: "Malachi", aliases: ["malachi", "mal", "ml"], verses: [14,17,18,6] },
  { num: 40, name: "Matthew", aliases: ["matthew", "matt", "mat", "mt"], verses: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20] },
  { num: 41, name: "Mark", aliases: ["mark", "mrk", "mar", "mk", "mr"], verses: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20] },
  { num: 42, name: "Luke", aliases: ["luke", "luk", "lk"], verses: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53] },
  { num: 43, name: "John", aliases: ["john", "joh", "jhn", "jn"], verses: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25] },
  { num: 44, name: "Acts", aliases: ["acts", "act", "ac"], verses: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31] },
  { num: 45, name: "Romans", aliases: ["romans", "rom", "ro", "rm"], verses: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27] },
  { num: 46, name: "1 Corinthians", aliases: ["1 corinthians", "1 cor", "1cor", "1 co", "1co"], verses: [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24] },
  { num: 47, name: "2 Corinthians", aliases: ["2 corinthians", "2 cor", "2cor", "2 co", "2co"], verses: [24,17,18,18,21,18,16,24,15,18,33,21,14] },
  { num: 48, name: "Galatians", aliases: ["galatians", "gal", "ga"], verses: [24,21,29,31,26,18] },
  { num: 49, name: "Ephesians", aliases: ["ephesians", "eph", "ephes"], verses: [23,22,21,32,33,24] },
  { num: 50, name: "Philippians", aliases: ["philippians", "phil", "php", "pp"], verses: [30,30,21,23] },
  { num: 51, name: "Colossians", aliases: ["colossians", "col", "co"], verses: [29,23,25,18] },
  { num: 52, name: "1 Thessalonians", aliases: ["1 thessalonians", "1 thess", "1 thes", "1thess", "1 th", "1th"], verses: [10,20,13,18,28] },
  { num: 53, name: "2 Thessalonians", aliases: ["2 thessalonians", "2 thess", "2 thes", "2thess", "2 th", "2th"], verses: [12,17,18] },
  { num: 54, name: "1 Timothy", aliases: ["1 timothy", "1 tim", "1tim", "1 ti", "1ti"], verses: [20,15,16,16,25,21] },
  { num: 55, name: "2 Timothy", aliases: ["2 timothy", "2 tim", "2tim", "2 ti", "2ti"], verses: [18,26,17,22] },
  { num: 56, name: "Titus", aliases: ["titus", "tit", "ti"], verses: [16,15,15] },
  { num: 57, name: "Philemon", aliases: ["philemon", "philem", "phlm", "phm", "phi"], verses: [25] },
  { num: 58, name: "Hebrews", aliases: ["hebrews", "heb", "hbr"], verses: [14,18,19,16,14,20,28,13,28,39,40,29,25] },
  { num: 59, name: "James", aliases: ["james", "jas", "jm", "jam"], verses: [27,26,18,17,20] },
  { num: 60, name: "1 Peter", aliases: ["1 peter", "1 pet", "1pet", "1 pe", "1pe", "1 pt", "1p"], verses: [25,25,22,19,14] },
  { num: 61, name: "2 Peter", aliases: ["2 peter", "2 pet", "2pet", "2 pe", "2pe", "2 pt", "2p"], verses: [21,22,18] },
  { num: 62, name: "1 John", aliases: ["1 john", "1 jn", "1jn", "1 jhn", "1 jo", "1jo", "1j"], verses: [10,29,24,21,21] },
  { num: 63, name: "2 John", aliases: ["2 john", "2 jn", "2jn", "2 jhn", "2 jo", "2jo", "2j"], verses: [13] },
  { num: 64, name: "3 John", aliases: ["3 john", "3 jn", "3jn", "3 jhn", "3 jo", "3jo", "3j"], verses: [14] },
  { num: 65, name: "Jude", aliases: ["jude", "jud", "jd"], verses: [25] },
  { num: 66, name: "Revelation", aliases: ["revelation", "revelations", "rev", "re", "rv", "apocalypse"], verses: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21] },
];

// Total verses in the pinned canon (31,102 in KJV) — handy for the "no rows"
// contrast in the ADR and as a sanity check in the verify script.
export const TOTAL_VERSES = CANON.reduce(
  (sum, b) => sum + b.verses.reduce((a, v) => a + v, 0),
  0
);

// num → book, built once. num is 1-based and contiguous, so an array indexed by
// num works (index 0 unused).
const BY_NUM: (CanonBook | undefined)[] = (() => {
  const arr: (CanonBook | undefined)[] = [];
  for (const b of CANON) arr[b.num] = b;
  return arr;
})();

export function bookByNum(num: number): CanonBook | null {
  return BY_NUM[num] ?? null;
}

// alias → book, built once. Every alias is stored pre-lowercased and dot-free in
// CANON, so the lookup just normalizes the query the same way.
const BY_ALIAS: Map<string, CanonBook> = (() => {
  const m = new Map<string, CanonBook>();
  for (const b of CANON) for (const a of b.aliases) m.set(a, b);
  return m;
})();

// Normalize a book token for matching: lowercase, drop periods, collapse inner
// whitespace, and fold a leading ordinal word/roman/ordinal-suffix to a digit so
// "First Corinthians", "I Cor", "1st Cor" all reduce to "1 cor". Returns the
// cleaned token; the caller looks it up in BY_ALIAS.
function normalizeBookToken(raw: string): string {
  let s = raw.toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
  s = s
    .replace(/^(first|1st|i)\s+/, "1 ")
    .replace(/^(second|2nd|ii)\s+/, "2 ")
    .replace(/^(third|3rd|iii)\s+/, "3 ");
  // A digit directly glued to letters ("1cor") keeps working because the aliases
  // list both "1cor" and "1 cor"; but normalize "1  cor" → "1 cor" here.
  return s.replace(/^([1-3])\s+/, "$1 ");
}

// Resolve a book name/abbreviation to its canon entry, or null. Case-, dot-, and
// ordinal-insensitive. Exact alias match only (no prefix guessing) — a wrong
// book is worse than no match, and the @/ref picker lists candidates anyway.
export function findBook(token: string): CanonBook | null {
  const norm = normalizeBookToken(token);
  const direct = BY_ALIAS.get(norm);
  if (direct) return direct;
  // Also try the glued form ("1cor") if the spaced form missed, and vice versa.
  const glued = norm.replace(/^([1-3])\s+/, "$1");
  return BY_ALIAS.get(glued) ?? null;
}

// The chapter count of a book (0 if unknown).
export function chapterCount(book: CanonBook): number {
  return book.verses.length;
}

// The verse count of a specific chapter (1-based), or 0 if the chapter is out of
// range. This is the validator behind "does Romans have a ch. 17?" (returns 0).
export function verseCount(book: CanonBook, chapter: number): number {
  if (chapter < 1 || chapter > book.verses.length) return 0;
  return book.verses[chapter - 1];
}
