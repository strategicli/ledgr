// The Papers module's structured shapes (Papers module, P1). A `paper` item is
// markdown-canonical: items.body holds the final draft ({ format:"markdown",
// text }). The *scaffold* — the outline and the quote bank that sit beside the
// draft while writing — lives in items.properties (no schema migration; the
// existing PATCH path already replaces properties wholesale). This file is the
// one place those property shapes are defined, shared by the citation engine,
// the quote-bank UI, the docx renderer, and the verify script.
//
// Import-pure (no React, no DB, no docx) so the citation engine that depends on
// it runs identically in the client, the export route, and a node verify script
// — the same discipline the Songs module's chordpro/ core follows.

// A bibliographic source a quote is drawn from. Two kinds cover the seminary
// workflow's sources (Paper_Outline_Viewer_Build_Spec §"Source attribution
// rules"); the union is keyed on `kind` so the citation engine and a future
// source kind (journal, web) extend by adding a member, not a flag.
export type BookSource = {
  kind: "book";
  // The full author string as it appears in a first reference ("Patrick
  // Schreiner", or "Andreas J. Köstenberger, L. Scott Kellum, and Charles L.
  // Quarles" for multi-author works). The writer types it once.
  author: string;
  // The surname used in the shortened form ("Schreiner", "Köstenberger").
  authorLast: string;
  title: string; // full title incl. subtitle, italicized in output
  shortTitle: string; // the shortened-form title
  editor?: string; // "ed. <name>" clause, omitted when absent
  city: string;
  publisher: string;
  year: string;
};

export type VideoSource = {
  kind: "video";
  author: string;
  authorLast: string;
  title: string; // full video title, quoted in output
  shortTitle: string;
  url: string;
  accessed: string; // "Month Day, Year"
};

export type Source = BookSource | VideoSource;

// One quote-bank entry: a source, the page it's on (books only), and the quote
// text the writer pulled. `id` is the stable handle the quote-bank UI keys on;
// it is NOT the footnote marker (each *insertion* mints its own unique marker so
// a first reference and a later shortened reference are distinct numbered notes,
// the way msm-render allocates footnotes positionally).
export type QuoteEntry = {
  id: string;
  source: Source;
  page?: string;
  text: string;
};

// The paper's title-page metadata, stored under these keys in items.properties
// and read by the docx renderer. The paper *title* is the item's title field,
// not duplicated here.
export type PaperMeta = {
  school?: string;
  paper_type?: string;
  course?: string;
  author?: string;
  location?: string;
  paper_date?: string;
  stage?: string;
};

// The full scaffold the paper canvas owns inside items.properties. Spread over
// any pre-existing properties so system keys (email/todoist/calendar/…) a paper
// is unlikely to have but might inherit are never clobbered.
export type PaperScaffold = PaperMeta & {
  outline?: string; // markdown
  quoteBank?: QuoteEntry[];
};

// The stages a paper moves through (the workflow in the build spec: shape →
// gather quotes → outline → draft → edit → done). Surfaced as a select in the
// title-page meta form and seeded into the type's property_schema.
export const PAPER_STAGES = [
  "shaping",
  "quote-gathering",
  "outlining",
  "drafting",
  "editing",
  "done",
] as const;
