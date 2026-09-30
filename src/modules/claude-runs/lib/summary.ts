// The ping text for a Claude Run (ADR-286): the body's first non-empty line,
// markdown marks stripped, capped for a phone notification. Pure, so the CI
// check can prove it without a database.
export function summaryLine(body: unknown): string {
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string") return "";
  const line =
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/^[\s#>*+-]+/, "").replace(/\*\*|__/g, "").trim())
      .find(Boolean) ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}
