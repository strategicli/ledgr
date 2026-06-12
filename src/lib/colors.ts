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
