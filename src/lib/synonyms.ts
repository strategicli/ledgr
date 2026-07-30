// Query-time term expansion for fuzzy search (ADR-172). Deterministic, no model
// in the loop (Principle 3): one typed word becomes an OR-tsquery covering its
// synonyms, its number-word twin, and anything the owner added to their personal
// dictionary. Same inputs always give the same query.
//
// Three layers, in precedence order:
//   1. The owner's dictionary (users.settings.searchSynonyms) — always wins, and
//      is the fix for anything the other two can't know (Edgewood vocabulary:
//      "message" meaning sermon, campus abbreviations, staff nicknames).
//   2. WordNet (src/data/synonyms.json, built by scripts/build-synonyms.mts).
//   3. Number words, both directions ("4" <-> "four", "4th" <-> "fourth").
//
// Stemming is NOT here: Postgres FTS already stems inside the tsvector, so
// "teaching" matches "teach"/"taught"/"teaches" for free. Adding morphological
// variants here would be duplicating the database's job.
//
// WordNet cannot tell which SENSE of a word you meant, so an expansion carries
// some wrong-sense noise by design ("lesson" reaches "moral"). That is safe here
// because a synonym hit is only ever ranked BELOW an exact hit and scaled by the
// criterion's confidence, so noise can rank low but never outrank or hide the
// real thing. The owner's own disambiguation lever is typing several words: the
// sense they share accumulates score across criteria. See lib/search-deep.ts.
import rawSynonyms from "@/data/synonyms.json";

// The generated map, minus its license field. ~44k words, ~1.8MB, parsed once per
// server instance on first import and then cached — we only ever hash-lookup the
// handful of words in one query, never scan it.
const WORDNET = rawSynonyms as unknown as Record<string, string[] | string>;

// Cardinals and ordinals worth the bytes: 0-20 plus the round tens, which covers
// how a person actually writes a number in a title ("4 week series", "Fourth of
// July", "3rd service"). Beyond that, spelled-out numbers are vanishingly rare.
const NUMBER_PAIRS: [string, string][] = [
  ["0", "zero"], ["1", "one"], ["2", "two"], ["3", "three"], ["4", "four"],
  ["5", "five"], ["6", "six"], ["7", "seven"], ["8", "eight"], ["9", "nine"],
  ["10", "ten"], ["11", "eleven"], ["12", "twelve"], ["13", "thirteen"],
  ["14", "fourteen"], ["15", "fifteen"], ["16", "sixteen"], ["17", "seventeen"],
  ["18", "eighteen"], ["19", "nineteen"], ["20", "twenty"], ["30", "thirty"],
  ["40", "forty"], ["50", "fifty"], ["60", "sixty"], ["70", "seventy"],
  ["80", "eighty"], ["90", "ninety"], ["100", "hundred"], ["1000", "thousand"],
  ["1st", "first"], ["2nd", "second"], ["3rd", "third"], ["4th", "fourth"],
  ["5th", "fifth"], ["6th", "sixth"], ["7th", "seventh"], ["8th", "eighth"],
  ["9th", "ninth"], ["10th", "tenth"],
];

// Both directions in one lookup, built once at module load.
const NUMBER_TWINS = new Map<string, string>();
for (const [digit, word] of NUMBER_PAIRS) {
  NUMBER_TWINS.set(digit, word);
  NUMBER_TWINS.set(word, digit);
}

// Guard against one term ballooning the tsquery. Well above what the pruned
// WordNet map yields (avg 2.6), so it only ever bites a huge personal entry.
const MAX_EXPANSION = 12;

export type PersonalDictionary = Record<string, string[]>;

/**
 * Every search word one typed term should match, the term itself first.
 * Lowercased and deduped. A multi-word term is treated as a phrase and is NOT
 * expanded (no dictionary has an entry for "staff meeting", and quietly
 * expanding one word of a phrase would change what the owner asked for).
 */
export function expandTerm(term: string, personal: PersonalDictionary = {}): string[] {
  const word = term.trim().toLowerCase();
  if (!word) return [];
  if (/\s/.test(word)) return [word];

  const out = [word];
  const add = (candidate: string) => {
    const c = candidate.trim().toLowerCase();
    if (c && c !== word && !out.includes(c) && out.length < MAX_EXPANSION) out.push(c);
  };

  // 1. The owner's dictionary first, so their words outrank WordNet's on the cap.
  for (const extra of personal[word] ?? []) add(extra);

  // 2. WordNet.
  const wordnet = WORDNET[word];
  if (Array.isArray(wordnet)) for (const syn of wordnet) add(syn);

  // 3. The number-word twin.
  const twin = NUMBER_TWINS.get(word);
  if (twin) add(twin);

  return out;
}

/**
 * One typed term as a websearch_to_tsquery string: `teaching OR instruction OR
 * pedagogy`. Multi-word terms come back quoted so FTS treats them as a phrase.
 *
 * websearch_to_tsquery never throws on malformed input (that's why lib/search.ts
 * binds the raw query straight in), and every word here is either the owner's own
 * text or a `^[a-z]{3,}$` map entry, so nothing needs escaping. Returns "" for an
 * empty term; the caller drops empty criteria rather than querying for nothing.
 */
export function termToTsQuery(term: string, personal: PersonalDictionary = {}): string {
  const words = expandTerm(term, personal);
  if (words.length === 0) return "";
  return words.map((w) => (/\s/.test(w) ? `"${w}"` : w)).join(" OR ");
}

/** How many alternates a term picked up, for the "+ 6 synonyms" hint in the UI. */
export function expansionCount(term: string, personal: PersonalDictionary = {}): number {
  return Math.max(expandTerm(term, personal).length - 1, 0);
}
