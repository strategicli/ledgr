// The single BlockNote-color → export-encoding mapping table (PRD §4.1).
// The markdown serializer reads it on the way out and any future importer
// reads it on the way back in; nothing else may hard-code these names or
// hexes. Values mirror BlockNote's COLORS_DEFAULT palette (which is itself
// Notion's), pinned here so a BlockNote upgrade can't silently change what
// exported documents mean.

export const BLOCKNOTE_COLORS = {
  gray: { text: "#9b9a97", background: "#ebeced" },
  brown: { text: "#64473a", background: "#e9e5e3" },
  red: { text: "#e03e3e", background: "#fbe4e4" },
  orange: { text: "#d9730d", background: "#f6e9d9" },
  yellow: { text: "#dfab01", background: "#fbf3db" },
  green: { text: "#4d6461", background: "#ddedea" },
  blue: { text: "#0b6e99", background: "#ddebf1" },
  purple: { text: "#6940a5", background: "#eae4f2" },
  pink: { text: "#ad1a72", background: "#f4dfeb" },
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

const BG_HEX_TO_COLOR: Record<string, BlockNoteColor> = Object.fromEntries(
  (Object.keys(BLOCKNOTE_COLORS) as BlockNoteColor[]).map((c) => [
    BLOCKNOTE_COLORS[c].background.toLowerCase(),
    c,
  ])
) as Record<string, BlockNoteColor>;

function hexInStyle(style: string): string | null {
  const m = style.match(/#[0-9a-fA-F]{3,8}/);
  return m ? m[0].toLowerCase() : null;
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
    const hex = hexInStyle(style);
    if (hex && hex in BG_HEX_TO_COLOR) return BG_HEX_TO_COLOR[hex];
  }
  return null;
}
