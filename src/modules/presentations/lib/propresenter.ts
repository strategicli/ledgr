// ProPresenter plain-text export (explorations/presentations.md export step).
// ProPresenter's text import splits slides on blank lines, so a slide's block
// must never carry an internal blank line: each slide's lines are joined with
// single newlines, and blocks are separated by exactly one blank line. Pure —
// no DB — so scripts/verify-presentation-export.mts can exercise it directly.
import type { DeckSlide } from "./deck";

const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;

// One markdown line -> plain text: strip heading/list/quote markers, images,
// links (keep the label) and emphasis, in that order. Deliberately simple
// (line-based, not a full markdown parse) — a slide's markdown is short and
// shallow by construction (deck.ts's own slides).
function plainLine(line: string): string {
  if (FENCE_RE.test(line)) return "";
  return line
    .replace(/^ {0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(IMAGE_RE, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// Notes never reach ProPresenter (they're the presenter's own cue sheet), and
// an image-only slide has nothing to import as text, so both are skipped.
export function deckToProPresenterText(slides: Pick<DeckSlide, "md">[]): string {
  const blocks: string[] = [];
  for (const s of slides) {
    const withoutImages = (s.md ?? "").replace(IMAGE_RE, "");
    if (!withoutImages.trim()) continue;
    const lines = withoutImages
      .split("\n")
      .map(plainLine)
      .filter(Boolean);
    if (lines.length === 0) continue;
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}
