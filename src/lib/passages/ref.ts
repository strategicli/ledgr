// The passage reference resolver (ADR-143, decision pt 3) — the no-regret first
// piece: a pure, deterministic map between human scripture references, a
// canonical integer, and the `ledgr://passage/` body URI. No DB, no markdown
// rendering, no owner scope, so it is safe on both client and server and is the
// one definition the editor picker, the on-save sync (refs.ts), the passage
// page, and any future auto-tagger all share.
//
// Encoding (pt 3): a verse is `book·1_000_000 + chapter·1_000 + verse`
// (Rom 8:5 = 45_008_005). Max chapter 150 (Psalms) and max verse 176 (Ps 119)
// both sit under 1_000, so the three fields never bleed into each other. A
// passage is a closed integer interval `[startRef, endRef]`; a single verse is
// the degenerate interval where start == end. Ranges are ONE object, never fanned
// out to per-verse edges — that is the whole point of the reversible-direction
// argument in the ADR.

import {
  type CanonBook,
  bookByNum,
  chapterCount,
  findBook,
  verseCount,
} from "./canon";

// The passage body URI (ADR-143, Tyler review pt 6 — a canonical-body-format
// concern, so its grammar is fixed here once). A passage mention serializes to a
// markdown link exactly like an item mention (ledgr://item/<id>): the href is
// canonical, the label is human. Href form: `ledgr://passage/<start>` for a
// single verse, `ledgr://passage/<start>-<end>` for a range. Integers, not
// "Rom.8.5", so the stored link never drifts with book-name spelling and the
// overlap query reads the two ints directly.
export const PASSAGE_URI_PREFIX = "ledgr://passage/";

const BOOK_FACTOR = 1_000_000;
const CHAPTER_FACTOR = 1_000;

// A resolved passage: a closed integer interval. start <= end always holds.
export type PassageRef = { startRef: number; endRef: number };

export type DecodedRef = { book: number; chapter: number; verse: number };

export function encodeRef(book: number, chapter: number, verse: number): number {
  return book * BOOK_FACTOR + chapter * CHAPTER_FACTOR + verse;
}

export function decodeRef(ref: number): DecodedRef {
  const book = Math.floor(ref / BOOK_FACTOR);
  const rem = ref % BOOK_FACTOR;
  return { book, chapter: Math.floor(rem / CHAPTER_FACTOR), verse: rem % CHAPTER_FACTOR };
}

// Interval helpers — the passage-page query (refs.ts) runs these in SQL, but the
// pure forms live here so tests and any in-memory filter agree with the DB.
// "does this passage cover this single verse?"
export function contains(passage: PassageRef, verseRef: number): boolean {
  return passage.startRef <= verseRef && verseRef <= passage.endRef;
}
// "do these two passages overlap at all?" (startA <= endB AND startB <= endA)
export function overlaps(a: PassageRef, b: PassageRef): boolean {
  return a.startRef <= b.endRef && b.startRef <= a.endRef;
}

// The locator tail of a reference: chapter, optional :verse, optional range end.
// Book text is everything before it. Lazy book group stops at the space before
// the first chapter digit. Hyphen/en-dash/em-dash all read as a range separator.
//   Rom 8            -> ch 8 (whole chapter)
//   Rom 8:5          -> ch 8 v 5
//   Rom 8:5-9        -> ch 8 vv 5..9
//   Rom 8:5-9:2      -> ch 8 v 5 .. ch 9 v 2
//   Rom 8-9          -> chs 8..9 (whole chapters)
const REF_RE =
  /^\s*(.+?)\s+(\d+)(?::(\d+))?(?:\s*[-–—]\s*(?:(\d+)\s*:\s*)?(\d+))?\s*$/;

// Parse a human reference to a validated [start,end] interval, or null. Every
// number is validated against the pinned canon (canon.ts), so "Rom 8:99" or
// "Rom 17:1" (no ch. 17) returns null rather than a bogus ref. A book name with
// no chapter/verse ("Romans", "1 John") resolves to the whole book.
export function parsePassageRef(input: string): PassageRef | null {
  const text = input.trim();
  if (!text) return null;

  // Whole-book form: no digits at all, just a book name.
  if (!/\d/.test(text)) {
    const book = findBook(text);
    if (!book) return null;
    return wholeBook(book);
  }

  const m = REF_RE.exec(text);
  if (!m) return null;
  const [, bookToken, chStr, vStr, endChStr, endValStr] = m;
  const book = findBook(bookToken);
  if (!book) return null;

  const startChapter = Number(chStr);
  if (!validChapter(book, startChapter)) return null;

  if (vStr !== undefined) {
    // Verse-anchored start.
    const startVerse = Number(vStr);
    if (!validVerse(book, startChapter, startVerse)) return null;
    const startRef = encodeRef(book.num, startChapter, startVerse);

    if (endValStr === undefined) return { startRef, endRef: startRef };
    // Range end: an explicit end chapter means cross-chapter; otherwise the end
    // verse is in the start chapter.
    const endChapter = endChStr !== undefined ? Number(endChStr) : startChapter;
    const endVerse = Number(endValStr);
    if (!validVerse(book, endChapter, endVerse)) return null;
    const endRef = encodeRef(book.num, endChapter, endVerse);
    return endRef >= startRef ? { startRef, endRef } : null;
  }

  // Whole-chapter start (no verse).
  const startRef = encodeRef(book.num, startChapter, 1);
  if (endValStr === undefined) {
    // Single whole chapter: verse 1 .. last verse.
    return { startRef, endRef: encodeRef(book.num, startChapter, verseCount(book, startChapter)) };
  }
  if (endChStr !== undefined) {
    // "8-9:2": chapter-range start but an explicit end verse.
    const endChapter = Number(endChStr);
    const endVerse = Number(endValStr);
    if (!validVerse(book, endChapter, endVerse)) return null;
    const endRef = encodeRef(book.num, endChapter, endVerse);
    return endRef >= startRef ? { startRef, endRef } : null;
  }
  // "8-9": the number after the dash is a whole end chapter.
  const endChapter = Number(endValStr);
  if (!validChapter(book, endChapter) || endChapter < startChapter) return null;
  return { startRef, endRef: encodeRef(book.num, endChapter, verseCount(book, endChapter)) };
}

function wholeBook(book: CanonBook): PassageRef {
  const lastChapter = chapterCount(book);
  return {
    startRef: encodeRef(book.num, 1, 1),
    endRef: encodeRef(book.num, lastChapter, verseCount(book, lastChapter)),
  };
}

function validChapter(book: CanonBook, chapter: number): boolean {
  return Number.isInteger(chapter) && chapter >= 1 && chapter <= chapterCount(book);
}

function validVerse(book: CanonBook, chapter: number, verse: number): boolean {
  return validChapter(book, chapter) && Number.isInteger(verse) && verse >= 1 && verse <= verseCount(book, chapter);
}

// Render a [start,end] interval back to a human label ("Romans 8:5–9",
// "Psalm 23", "John 3:16"). Uses an en-dash for ranges to match the ADR
// examples. A range crossing chapters shows both chapters; a whole chapter (or
// whole book) collapses to the shortest correct form.
export function formatPassageRef(startRef: number, endRef: number): string {
  const s = decodeRef(startRef);
  const e = decodeRef(endRef);
  const book = bookByNum(s.book);
  if (!book) return `${startRef}${endRef !== startRef ? `-${endRef}` : ""}`;
  const name = book.name;

  if (startRef === endRef) return `${name} ${s.chapter}:${s.verse}`;

  // Whole book: ch1v1 .. lastCh lastV.
  const lastChapter = chapterCount(book);
  if (
    s.chapter === 1 && s.verse === 1 &&
    e.chapter === lastChapter && e.verse === verseCount(book, lastChapter)
  ) {
    return name;
  }

  // Whole chapter(s): start at v1 and end at the end chapter's last verse.
  const wholeChapters = s.verse === 1 && e.verse === verseCount(book, e.chapter);
  if (wholeChapters) {
    return s.chapter === e.chapter ? `${name} ${s.chapter}` : `${name} ${s.chapter}–${e.chapter}`;
  }

  if (s.chapter === e.chapter) return `${name} ${s.chapter}:${s.verse}–${e.verse}`;
  return `${name} ${s.chapter}:${s.verse}–${e.chapter}:${e.verse}`;
}

// The canonical body URI for a passage interval (see PASSAGE_URI_PREFIX).
export function passageUri(startRef: number, endRef: number): string {
  return endRef === startRef
    ? `${PASSAGE_URI_PREFIX}${startRef}`
    : `${PASSAGE_URI_PREFIX}${startRef}-${endRef}`;
}

// The URL slug for the passage page: the same `<start>[-<end>]` grammar as the
// URI, minus the scheme. `/passage/45008005` or `/passage/45008005-45008009`.
export function passageSlug(startRef: number, endRef: number): string {
  return endRef === startRef ? `${startRef}` : `${startRef}-${endRef}`;
}

// Parse a bare `<start>[-<end>]` slug (the passage page's [ref] segment) to an
// interval, or null. The shared core of parsePassageUri.
export function parsePassageSlug(slug: string): PassageRef | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(slug.trim());
  if (!m) return null;
  const startRef = Number(m[1]);
  const endRef = m[2] !== undefined ? Number(m[2]) : startRef;
  if (!Number.isSafeInteger(startRef) || !Number.isSafeInteger(endRef) || endRef < startRef) {
    return null;
  }
  return { startRef, endRef };
}

// Parse a `ledgr://passage/<start>[-<end>]` href back to an interval, or null if
// it isn't a passage URI. The way IN from a parsed markdown link, mirroring
// mentionItemId in editor/mention-markdown.ts.
export function parsePassageUri(href: string | null | undefined): PassageRef | null {
  if (typeof href !== "string" || !href.startsWith(PASSAGE_URI_PREFIX)) return null;
  return parsePassageSlug(href.slice(PASSAGE_URI_PREFIX.length));
}

function escapeLabel(text: string): string {
  return text.replace(/[\\[\]]/g, (c) => `\\${c}`);
}

// A passage link's markdown, matching the mention link shape exactly so the
// body sync can find it and the renderer can chip it. Label defaults to the
// human form of the interval.
export function passageToMarkdown(startRef: number, endRef: number, label?: string): string {
  const text = label ?? formatPassageRef(startRef, endRef);
  return `[${escapeLabel(text)}](${passageUri(startRef, endRef)})`;
}

// Every distinct passage interval referenced in a markdown body, in first-seen
// order. The markdown-native diff source for syncPassageRefs (refs.ts), the exact
// analog of collectMentionIdsFromMarkdown: scan for the ledgr://passage/ href.
export function collectPassageRefsFromMarkdown(markdown: string): PassageRef[] {
  if (!markdown) return [];
  const seen = new Set<string>();
  const out: PassageRef[] = [];
  const re = /ledgr:\/\/passage\/(\d+)(?:-(\d+))?/g;
  for (const m of markdown.matchAll(re)) {
    const startRef = Number(m[1]);
    const endRef = m[2] !== undefined ? Number(m[2]) : startRef;
    if (!Number.isSafeInteger(startRef) || !Number.isSafeInteger(endRef) || endRef < startRef) continue;
    const key = `${startRef}-${endRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startRef, endRef });
  }
  return out;
}
