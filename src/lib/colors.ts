// The single color-name → export-encoding mapping table (PRD §4.1). The
// markdown serializer reads it on the way out and any future importer reads it
// on the way back in; nothing else may hard-code these names or values.
//
// The palette started as BlockNote's COLORS_DEFAULT (Notion's), but those were
// tuned for a white page: the text colors lacked contrast on Ledgr's dark
// canvas and the highlight backgrounds were ~95%-lightness pastels that all
// composited toward white on #191919. These values are retuned for the dark
// canvas (ADR: custom editor palette, 2026-07-16):
//   - text: bright, saturated hex (a true green, a cherry red), readable on dark.
//   - highlight: rgba() washes instead of near-white hex, so they read as
//     distinct colors on dark AND degrade to soft pastels over a white page —
//     one value works in both modes, so a future light mode needs no highlight
//     table. (Text colors can't do that; a light mode would need a second text
//     table.) Highlights round-trip via the hl-* class, not the value, so the
//     background may be any CSS color without breaking parse (see
//     highlightColorName below). Text colors still round-trip via exact hex.
// The names are the stable contract; changing a value means migrating stored
// bodies (scripts/backfill-editor-colors.mts) so old inline hexes still map back.

export const BLOCKNOTE_COLORS = {
  gray: { text: "#a1a1aa", background: "rgba(148,148,148,0.40)" },
  brown: { text: "#c08552", background: "rgba(150,95,55,0.45)" },
  red: { text: "#f23a4a", background: "rgba(242,58,74,0.42)" },
  orange: { text: "#fb923c", background: "rgba(249,115,22,0.42)" },
  yellow: { text: "#facc15", background: "rgba(234,179,8,0.45)" },
  green: { text: "#4ade80", background: "rgba(34,197,94,0.42)" },
  blue: { text: "#60a5fa", background: "rgba(59,130,246,0.42)" },
  purple: { text: "#c084fc", background: "rgba(168,85,247,0.42)" },
  pink: { text: "#f472b6", background: "rgba(236,72,153,0.42)" },
} as const;

export type BlockNoteColor = keyof typeof BLOCKNOTE_COLORS;

export function isBlockNoteColor(name: unknown): name is BlockNoteColor {
  return typeof name === "string" && name in BLOCKNOTE_COLORS;
}

// Text color: standard inline HTML, renders everywhere with no plugin.
export function textColorTag(color: BlockNoteColor): {
  open: string;
  close: string;
} {
  return {
    open: `<span style="color:${BLOCKNOTE_COLORS[color].text}">`,
    close: "</span>",
  };
}

// Highlight: <mark> renders highlighted in Obsidian/GitHub with no plugin;
// the hl-* class is the stable hook for a CSS theme snippet, and the inline
// style keeps the exact color even without one.
export function highlightTag(color: BlockNoteColor): {
  open: string;
  close: string;
} {
  return {
    open: `<mark class="hl-${color}" style="background-color:${BLOCKNOTE_COLORS[color].background}">`,
    close: "</mark>",
  };
}

// Reverse lookups — the way back IN (markdown → editor). The serializer above
// owns the way out; these own the parse side so the round-trip is symmetric
// off the one table. Hex matching is case-insensitive and tolerant of
// shorthand spacing ("color: #abc"); the hl-* class is the primary,
// unambiguous hook for highlights.
const TEXT_HEX_TO_COLOR: Record<string, BlockNoteColor> = Object.fromEntries(
  (Object.keys(BLOCKNOTE_COLORS) as BlockNoteColor[]).map((c) => [
    BLOCKNOTE_COLORS[c].text.toLowerCase(),
    c,
  ])
) as Record<string, BlockNoteColor>;

// Highlight backgrounds are now rgba() (not hex), so match on the whole color
// value with spaces stripped, e.g. "rgba(242,58,74,0.42)". Keyed off the same
// table so it stays symmetric. The hl-* class is still the primary hook; this
// is the fallback for a highlight that reached us with its class stripped
// (some markdown processors / paste paths keep style but drop class).
const normColor = (v: string) => v.replace(/\s+/g, "").toLowerCase();
const BG_VALUE_TO_COLOR: Record<string, BlockNoteColor> = Object.fromEntries(
  (Object.keys(BLOCKNOTE_COLORS) as BlockNoteColor[]).map((c) => [
    normColor(BLOCKNOTE_COLORS[c].background),
    c,
  ])
) as Record<string, BlockNoteColor>;

function hexInStyle(style: string): string | null {
  const m = style.match(/#[0-9a-fA-F]{3,8}/);
  return m ? m[0].toLowerCase() : null;
}

// The background(-color) value out of a style string, normalized for lookup.
function bgValueInStyle(style: string): string | null {
  const m = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  return m ? normColor(m[1]) : null;
}

// A CSS color value (e.g. from a span's `color:`) back to its palette name,
// or null if it isn't one of ours.
export function textColorName(style: string): BlockNoteColor | null {
  const hex = hexInStyle(style);
  return hex && hex in TEXT_HEX_TO_COLOR ? TEXT_HEX_TO_COLOR[hex] : null;
}

// A <mark>'s class ("hl-yellow") or background style back to its palette name.
export function highlightColorName(
  className: string | null,
  style: string | null
): BlockNoteColor | null {
  const cls = (className ?? "").match(/\bhl-([a-z]+)\b/);
  if (cls && isBlockNoteColor(cls[1])) return cls[1];
  if (style) {
    const v = bgValueInStyle(style);
    if (v && v in BG_VALUE_TO_COLOR) return BG_VALUE_TO_COLOR[v];
  }
  return null;
}
