// The MSM citation engine (Papers module, P1). Deterministic, no model in the
// loop (Principle 3): given a structured source + page it produces the three
// footnote forms the Midwestern Style Manual (4th ed.) uses — first reference
// (Full), shortened reference (Short), and Ibid. — transcribed from
// Paper_Outline_Viewer_Build_Spec §"Source attribution rules (MSM)". The quote
// bank shows all three per entry and the writer inserts the right one (Full for
// a first reference, Short for a later one), exactly the muscle the hand-built
// HTML outline viewer's click-to-copy footnote popup provided.
//
// Output is markdown: titles use *…* italics (books) or "…" quotes (videos),
// which the docx renderer's inline parser turns into real runs. Pure — see
// types.ts.
import type { QuoteEntry, Source } from "@/lib/papers/types";

// The three citation forms for one reference. `ibid` is null when Ibid. cannot
// stand in (handled by the caller / manual final pass), but in practice every
// source supports it; kept as a string for a uniform shape.
export type CitationForms = {
  full: string;
  short: string;
  ibid: string;
};

// First reference — books:
//   Author First Last, *Title: Subtitle*, ed. Editor (City: Publisher, Year), page.
// First reference — video:
//   Author First Last, "Full Video Title," YouTube video, accessed Date, URL.
export function citeFull(source: Source, page?: string): string {
  if (source.kind === "book") {
    const editor = source.editor ? `, ed. ${source.editor}` : "";
    const pageClause = page ? `, ${page}` : "";
    return `${source.author}, *${source.title}*${editor} (${source.city}: ${source.publisher}, ${source.year})${pageClause}.`;
  }
  return `${source.author}, "${source.title}," YouTube video, accessed ${source.accessed}, ${source.url}.`;
}

// Shortened reference — books: `Last, *Short Title*, page.`
// Shortened reference — video: `Last, "Short Title."` (period inside the quote).
export function citeShort(source: Source, page?: string): string {
  if (source.kind === "book") {
    const pageClause = page ? `, ${page}` : "";
    return `${source.authorLast}, *${source.shortTitle}*${pageClause}.`;
  }
  return `${source.authorLast}, "${source.shortTitle}."`;
}

// Ibid. — books: `Ibid., page.` (or bare `Ibid.` when no page / same page).
// Ibid. — video: `Ibid.` (videos carry no page).
// The "never Ibid. as the first footnote on a page" rule depends on final
// layout and stays a manual pre-submission check (handoff doc) — not enforced
// here.
export function citeIbid(source: Source, page?: string): string {
  if (source.kind === "book" && page) return `Ibid., ${page}.`;
  return "Ibid.";
}

// Invert "First Last" → "Last, First" for a bibliography entry. Best-effort:
// falls back to the full string when the surname isn't a clean suffix.
function invertAuthor(author: string, authorLast: string): string {
  const idx = author.lastIndexOf(authorLast);
  if (idx <= 0) return author;
  const first = author.slice(0, idx).trim().replace(/,$/, "");
  return first ? `${authorLast}, ${first}` : authorLast;
}

// One MSM bibliography entry (alphabetical-list form, no page): books invert the
// author and end with the facts of publication; videos mirror the footnote shape
// without a page. Markdown italics like the footnote forms.
export function bibliographyEntry(source: Source): string {
  const author = invertAuthor(source.author, source.authorLast);
  if (source.kind === "book") {
    const editor = source.editor ? ` Edited by ${source.editor}.` : "";
    return `${author}. *${source.title}*.${editor} ${source.city}: ${source.publisher}, ${source.year}.`;
  }
  return `${author}. "${source.title}." YouTube video. Accessed ${source.accessed}. ${source.url}.`;
}

export function citationForms(source: Source, page?: string): CitationForms {
  return {
    full: citeFull(source, page),
    short: citeShort(source, page),
    ibid: citeIbid(source, page),
  };
}

// Convenience over a quote-bank entry (the entry carries its own page).
export function formsForEntry(entry: QuoteEntry): CitationForms {
  return citationForms(entry.source, entry.page);
}
