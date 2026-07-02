// Shared "/type" filter token used by every place you type a few words to find
// an item: the command palette, the @-mention picker, the + Relate box, and the
// /search page. A leading token like "/person bob" (or the unambiguous prefix
// "/per bob") narrows the lookup to one type, so a short, rarely-edited title (a
// person named just "First Last") stops getting buried under long notes that
// merely contain the words. The token is resolved on the client against the real
// type registry, so an unrecognized token never reaches the server as a filter —
// it just falls back to a literal search.
"use client";

export type TypeMeta = { key: string; label: string; icon: string | null };

// The type registry, fetched once per page load and shared across every picker
// so none of them pays a per-keystroke lookup. Memoized at module scope.
let typesPromise: Promise<TypeMeta[]> | null = null;
export function loadTypes(): Promise<TypeMeta[]> {
  typesPromise ??= fetch("/api/types")
    .then((r) => (r.ok ? r.json() : { types: [] }))
    .then((d: { types?: TypeMeta[] }) => d.types ?? [])
    .catch(() => [] as TypeMeta[]);
  return typesPromise;
}

// Map form (key → meta) for O(1) glyph/label lookup by type key.
export function loadTypeMetaMap(): Promise<Map<string, TypeMeta>> {
  return loadTypes().then((types) => new Map(types.map((t) => [t.key, t])));
}

export type ParsedTypeToken = {
  type: TypeMeta;
  // The remaining query after the token (may be "" — "/person" alone browses
  // recent people rather than searching).
  rest: string;
};

// Parse a leading "/type" token. Returns null (treat the text literally, no
// filter) when the input has no token, or when the token is unknown or
// ambiguous. Resolution is case-insensitive: an exact match on a type's key or
// label wins; otherwise a *unique* prefix match on either. Ambiguity resolves
// to null on purpose — better a literal search than the wrong filter.
export function parseTypeToken(
  input: string,
  types: TypeMeta[]
): ParsedTypeToken | null {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input);
  if (!m) return null;
  const token = m[1].toLowerCase();
  const rest = m[2] ?? "";

  const exact = types.find(
    (t) => t.key.toLowerCase() === token || t.label.toLowerCase() === token
  );
  if (exact) return { type: exact, rest };

  const prefixHits = types.filter(
    (t) =>
      t.key.toLowerCase().startsWith(token) ||
      t.label.toLowerCase().startsWith(token)
  );
  return prefixHits.length === 1 ? { type: prefixHits[0], rest } : null;
}
