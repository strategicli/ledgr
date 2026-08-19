// Reads a person's picture off its properties (the built-in `image` url field,
// migration 0053 / ADR-202 addendum 3). Pure + client-safe. Only http(s) URLs
// count — anything else (a stray string, a data: URI someone pasted) falls back
// to the avatar's initials/glyph rather than a broken <img>.
export function personImage(properties: unknown): string | null {
  const v = (properties as Record<string, unknown> | null | undefined)?.image;
  return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}
