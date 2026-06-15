// The nav icon library (slice: nav customization, ADR-056). A configurable nav
// slot stores an icon by key; this is the key -> SVG-path-set lookup that
// replaces the hardcoded switch(slot) NavShell used to carry. Paths are
// hand-rolled 24x24 stroke glyphs (no icon-library dependency, Principle 5),
// drawn with the same stroke conventions the rest of the chrome uses.
//
// Both the real nav (NavShell) and the Build-surface preview/picker read this,
// so an unknown or hand-edited icon key always renders *something* (falls back
// to the generic list glyph) rather than a blank or a crash.
export const NAV_ICONS = {
  // Navigation
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  inbox: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M4.5 6.5h15L21 13v6H3v-6l1.5-6.5Z"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  dashboard:
    '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  views: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>',
  items: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 3.5"/>',
  starred: '<path d="M12 2l2.9 6.3 6.9.8-5 4.8 1.2 6.9-6-3.3-6 3.3 1.2-6.9-5-4.8 6.9-.8z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/>',
  // Content types
  notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M14 3v5h5"/><path d="M14 3l5 5"/><path d="M16 16l2 2 4-4"/>',
  document: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>',
  meetings: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  links: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  people: '<circle cx="9" cy="7" r="4"/><path d="M2 21c0-4 3.1-7 7-7h4c3.9 0 7 3 7 7"/><circle cx="17" cy="9" r="3"/><path d="M20 21c0-2.7-1.5-5-4-6"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
  song: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sermon: '<path d="M12 2v6"/><path d="M5.5 7.5A6.5 6.5 0 0 0 12 20a6.5 6.5 0 0 0 6.5-12.5"/><path d="M9 22h6"/>',
  paper: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 12h8M8 15h5M8 18h3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  // Organization
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5l2-3h6a2 2 0 0 1 2 2z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  collection: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M6 10V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="15" rx="1.5"/>',
  // Tools
  tools: '<path d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.2l-5.1 5.1a1.5 1.5 0 0 0 2.1 2.1l5.1-5.1a3.5 3.5 0 0 0 4.2-4.6l-2 2-1.7-1.7 2-2Z"/>',
  bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  // Misc
  changelog: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
} as const;

export type NavIconKey = keyof typeof NAV_ICONS;

// The fallback icon for an unknown/missing key (a generic list glyph). Kept as a
// named constant so callers and tests agree on the fallback.
export const NAV_ICON_FALLBACK: NavIconKey = "items";

// Categorized icon keys for the Build-surface picker (labeled rows). The order
// here is the order the picker shows; every key in NAV_ICONS appears once.
export const NAV_ICON_GROUPS: { label: string; keys: NavIconKey[] }[] = [
  { label: "Navigation", keys: ["home", "inbox", "tasks", "search", "dashboard", "views", "items", "recent", "starred", "archive"] },
  { label: "Content", keys: ["notes", "document", "meetings", "links", "people", "person", "song", "sermon", "paper", "book", "bookmark"] },
  { label: "Organization", keys: ["folder", "tag", "collection", "filter", "layers", "grid", "table", "board"] },
  { label: "Tools", keys: ["tools", "bolt", "flag", "bell"] },
  { label: "Misc", keys: ["changelog", "calendar", "compass", "target", "heart", "trophy"] },
];

// Whether a string is a known icon key.
export function isNavIcon(key: unknown): key is NavIconKey {
  return typeof key === "string" && key in NAV_ICONS;
}

// The path-set for a key, falling back to the generic list glyph for anything
// unknown. The single resolution point both the renderer and the picker use.
export function navIconPaths(key: string): string {
  return isNavIcon(key) ? NAV_ICONS[key] : NAV_ICONS[NAV_ICON_FALLBACK];
}

// Render any icon into a standalone <svg> string (for non-React surfaces such as
// the print/share document, should they ever need a nav glyph). React surfaces
// use the <Icon> component in NavShell, which reads navIconPaths directly.
export function navIconSvg(key: string, size = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${navIconPaths(key)}</svg>`;
}
