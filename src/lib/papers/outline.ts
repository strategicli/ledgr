// Outline filing helpers (Papers module; v5). Pure, node-testable. Quotes file at
// three levels — under a paragraph, at the section level, or Unsorted — encoded
// as a destination token: "p:<paragraphId>", "s:<sectionId>", or "unsorted". A
// pointer to a deleted section/paragraph reads as Unsorted (nothing is lost).
import type { OutlineSection, QuoteEntry } from "@/lib/papers/types";

export function sectionIds(sections: OutlineSection[]): Set<string> {
  return new Set(sections.map((s) => s.id));
}
export function paragraphIds(sections: OutlineSection[]): Set<string> {
  return new Set(sections.flatMap((s) => s.paragraphs.map((p) => p.id)));
}

// The destination token a quote currently resolves to (validated against the
// live structure, so stale pointers fall back to Unsorted).
export function quoteToken(q: Pick<QuoteEntry, "sectionId" | "paragraphId">, sections: OutlineSection[]): string {
  if (q.paragraphId && paragraphIds(sections).has(q.paragraphId)) return `p:${q.paragraphId}`;
  if (q.sectionId && sectionIds(sections).has(q.sectionId)) return `s:${q.sectionId}`;
  return "unsorted";
}

// Turn a token back into the {sectionId, paragraphId} a quote should store.
export function applyToken(token: string): { sectionId?: string; paragraphId?: string } {
  if (token.startsWith("p:")) return { paragraphId: token.slice(2) };
  if (token.startsWith("s:")) return { sectionId: token.slice(2) };
  return {};
}

// Every filing destination for the move/refile pickers, labeled. A section with a
// single untitled paragraph still lists both the section level and that paragraph.
export function destinationsFor(sections: OutlineSection[]): { token: string; label: string }[] {
  const out: { token: string; label: string }[] = [];
  for (const s of sections) {
    const sLabel = s.title.trim() || "Untitled section";
    out.push({ token: `s:${s.id}`, label: `${sLabel} (whole section)` });
    s.paragraphs.forEach((p, i) =>
      out.push({ token: `p:${p.id}`, label: `${sLabel} · ${p.title?.trim() || `Paragraph ${i + 1}`}` })
    );
  }
  return out;
}

export function quotesForParagraph(quotes: QuoteEntry[], paragraphId: string): QuoteEntry[] {
  return quotes.filter((q) => q.paragraphId === paragraphId);
}
// Section-level = tagged to the section but not to any of its paragraphs.
export function sectionLevelQuotes(quotes: QuoteEntry[], sectionId: string): QuoteEntry[] {
  return quotes.filter((q) => q.sectionId === sectionId && !q.paragraphId);
}
export function unsortedQuotes(quotes: QuoteEntry[], sections: OutlineSection[]): QuoteEntry[] {
  return quotes.filter((q) => quoteToken(q, sections) === "unsorted");
}
