// Quote-paste parser (Papers module, P5 — v5 feedback). Deterministic, no model
// (Principle 3): given a pasted "quote + citation" blob, split the quote from
// the trailing bibliographic citation and parse the common Turabian/MSM *book*
// footnote form into a structured BookSource, e.g.
//
//   "Assurance is the fruit…" Patrick Schreiner, The Visual Word: Illustrated
//   Outlines of the New Testament Books, ed. Connor Sterchi (Chicago, IL: Moody
//   Publishers, 2021), 160.
//
// The writer reviews the result in the Quote Bank's EntryForm before saving, so
// this is best-effort: it nails the common single-author book case and degrades
// gracefully (returns the raw text as the quote with a blank source) when it
// can't recognize a citation. Pure (no React/DB/docx), like the rest of
// src/lib/papers — so it runs in the client, the export route, and a verify
// script, and is node-testable.
import type { BookSource } from "@/lib/papers/types";

export type ParsedQuote = {
  text: string; // the quote (citation stripped)
  source: Partial<BookSource> & { kind: "book" };
  page?: string;
};

function lastNameOf(author: string): string {
  // First author's surname: take the part before " and "/"," (multi-author),
  // then its last whitespace-separated token.
  const first = author.split(/\s+and\s+|,/)[0].trim();
  return first.split(/\s+/).pop() ?? first;
}

// Strip one layer of matching wrapping quotes (straight or curly) if the whole
// span is quoted; otherwise leave it (the example has trailing context sentences
// outside the quoted span, which we keep).
function unwrapQuotes(s: string): string {
  const m = s.match(/^[“"']([\s\S]*?)[”"']\s*$/);
  return m ? m[1].trim() : s;
}

export function parsePastedQuote(raw: string): ParsedQuote | null {
  const input = raw.replace(/\s+/g, " ").trim();
  if (!input) return null;

  // 1. Find the publication parenthetical + optional page, anchored to the end:
  //    (City: Publisher, Year)[, page].
  const pub = input.match(
    /\(([^():]+):\s*([^(),]+),\s*(\d{4})\)\s*,?\s*([0-9ivxlcdm–-]+)?\.?\s*$/i
  );
  if (!pub || pub.index === undefined) return null;

  const [, city, publisher, year, page] = pub;
  const beforePub = input.slice(0, pub.index).trim().replace(/,\s*$/, "");

  // 2. Split the quote from "Author, Title[, ed. X]". The author/title begins
  //    after the last *real* sentence boundary: a word + period (+ optional
  //    closing quote) + space. Skip citation/abbreviation periods ("ed.",
  //    "trans.", …) and single-letter initials ("J.") so they don't false-split.
  const ABBR = new Set(["ed", "eds", "trans", "vol", "no", "rev", "comp", "cf", "p", "pp"]);
  let lastBoundaryEnd = 0;
  for (const b of beforePub.matchAll(/([A-Za-z]+)\.["”']?\s+/g)) {
    const word = b[1];
    if (ABBR.has(word.toLowerCase())) continue; // citation abbreviation
    if (word.length === 1 && /[A-Z]/.test(word)) continue; // initial like "J."
    lastBoundaryEnd = b.index! + b[0].length;
  }
  const quote = unwrapQuotes(beforePub.slice(0, lastBoundaryEnd).trim());
  const authorTitle = beforePub.slice(lastBoundaryEnd).trim();

  const source: ParsedQuote["source"] = {
    kind: "book",
    city: city.trim(),
    publisher: publisher.trim(),
    year: year.trim(),
  };

  // 3. Author = up to the first ", "; the rest is the title (maybe ", ed. X").
  const comma = authorTitle.indexOf(", ");
  if (comma > 0) {
    const author = authorTitle.slice(0, comma).trim();
    let titlePart = authorTitle.slice(comma + 2).trim();
    const ed = titlePart.match(/,\s*ed\.\s*(.+)$/i);
    if (ed && ed.index !== undefined) {
      source.editor = ed[1].trim();
      titlePart = titlePart.slice(0, ed.index).trim();
    }
    source.author = author;
    source.authorLast = lastNameOf(author);
    source.title = titlePart;
    source.shortTitle = titlePart.split(":")[0].trim();
  }

  return { text: quote, source, page: page?.trim() || undefined };
}
