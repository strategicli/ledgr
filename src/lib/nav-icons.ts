// The nav icon library (slice: nav customization, ADR-056). A configurable nav
// slot stores an icon by key; this is the key -> SVG-path-set lookup that
// replaces the hardcoded switch(slot) NavShell used to carry. Paths are
// hand-rolled 24x24 stroke glyphs (no icon-library dependency, Principle 5),
// drawn with the same stroke conventions the rest of the chrome uses.
//
// Both the real nav (NavShell) and the Build-surface preview/picker read this,
// so an unknown or hand-edited icon key always renders *something* (falls back
// to the generic list glyph) rather than a blank or a crash.
import { AI_ICONS } from "@/lib/ai-icons";

export const NAV_ICONS = {
  // Navigation
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  inbox: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M4.5 6.5h15L21 13v6H3v-6l1.5-6.5Z"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  dashboard:
    '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  views: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  items: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 3.5"/>',
  starred: '<path d="M12 2l2.9 6.3 6.9.8-5 4.8 1.2 6.9-6-3.3-6 3.3 1.2-6.9-5-4.8 6.9-.8z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 13h4"/>',
  // Content types
  notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M14 3v5h5"/><path d="M14 3l5 5"/><path d="M16 16l2 2 4-4"/>',
  document: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/>',
  meetings: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  links: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  // Box + outbound arrow — "opens the link out"; the outbound-resource glyph the
  // Links widget uses (Tyler, 2026-07-01), distinct from the `links` chain.
  "external-link": '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  people: '<circle cx="9" cy="7" r="4"/><path d="M2 21c0-4 3.1-7 7-7h4c3.9 0 7 3 7 7"/><circle cx="17" cy="9" r="3"/><path d="M20 21c0-2.7-1.5-5-4-6"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
  song: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  sermon: '<path d="M12 2v6"/><path d="M5.5 7.5A6.5 6.5 0 0 0 12 20a6.5 6.5 0 0 0 6.5-12.5"/><path d="M9 22h6"/>',
  paper: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M8 12h8M8 15h5M8 18h3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  // A document with a checkmarked award badge — the Project type glyph.
  project:
    '<path d="M13 22 H6 a2 2 0 0 1 -2 -2 V7 L9 2 H18 a2 2 0 0 1 2 2 V11"/><path d="M9 2 V7 H4"/><path d="M7.5 11 H12"/><path d="M7.5 14 H11"/><circle cx="17" cy="15" r="4.2"/><path d="M15.2 15 l1.3 1.3 l2.4 -2.9"/><path d="M15.4 18.3 V22 l1.6 -1.3 l1.6 1.3 V18.3"/>',
  // Organization
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5l2-3h6a2 2 0 0 1 2 2z"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  collection: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M6 10V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="15" rx="1.5"/>',
  // Equalizer-style sliders — the item canvas "Properties" panel glyph.
  properties: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  // Connected nodes — the "Linked here" backlinks/connections panel glyph.
  affiliate: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M10.6 7.1 6.4 16.9M13.4 7.1 17.6 16.9M7.5 19h9"/>',
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
  // Import/download — an arrow dropping down onto a baseline (the "bring data in"
  // glyph for Build → Import & Migration).
  download: '<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
  // Mindmap — a central hub node branching out to spoke nodes (the Mindmap type
  // glyph; distinct from `affiliate`'s peer triangle and the action-menu network).
  mindmap:
    '<circle cx="4.5" cy="12" r="2.5"/><circle cx="18.5" cy="5" r="2"/><circle cx="18.5" cy="12" r="2"/><circle cx="18.5" cy="19" r="2"/><path d="M7 11 16.6 5.7M7 12h9.5M7 13 16.6 18.3"/>',
  // Education set (Tyler, 2026-07-01) — recreated in the house style from a
  // reference sheet: ID card, certificate, assignment, geometry, globe,
  // textbook, backpack.
  "id-card":
    '<rect x="3" y="4" width="18" height="13" rx="2"/><circle cx="8" cy="9.5" r="2"/><path d="M5 15c0-1.9 1.3-3.2 3-3.2s3 1.3 3 3.2"/><path d="M14 9.5h4M14 13h4"/><path d="M6 20.5h12"/>',
  certificate:
    '<rect x="3" y="3" width="18" height="11" rx="1.5"/><path d="M12 7.5h6M12 10.5h6"/><circle cx="8" cy="8.5" r="2.6"/><path d="M6.1 10.6 5.6 20l2.4-1.6 2.4 1.6-.5-9.4"/>',
  assignment:
    '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 11h5M8 14h3"/><path d="M18.7 12.3 12.2 18.8l-2.4.6.6-2.4 6.5-6.5a1.3 1.3 0 0 1 1.8 1.8z"/>',
  geometry:
    '<path d="M9 5v14h11z"/><path d="M11.2 19v-2.2H9"/><path d="M4.5 6v3.5M4.5 14.5V18"/><path d="M3 7.5 4.5 6 6 7.5M3 16.5 4.5 18 6 16.5"/><path d="M3.4 10.8 5.6 13.2M5.6 10.8 3.4 13.2"/>',
  globe:
    '<circle cx="12" cy="9" r="5.5"/><ellipse cx="12" cy="9" rx="2.4" ry="5.5"/><path d="M6.5 9h11"/><path d="M12 14.5V18"/><path d="M8.5 20.5c0-1.3 1.6-2 3.5-2s3.5.7 3.5 2z"/>',
  textbook:
    '<rect x="4" y="3" width="16" height="13" rx="1.5"/><path d="M8 3v13"/><path d="M5.5 16v2.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  backpack:
    '<path d="M9.5 5.5a2.5 2.5 0 0 1 5 0"/><rect x="5" y="5.5" width="14" height="15.5" rx="4.5"/><path d="M8 21v-5.5a4 4 0 0 1 8 0V21"/><path d="M9.5 14.5h5"/><path d="M5 11c-1.4.3-2 1.2-2 2.6s.6 2.3 2 2.6M19 11c1.4.3 2 1.2 2 2.6s-.6 2.3-2 2.6"/>',
  // Line-art set (Tyler, 2026-07-01) — recreated in the house style from
  // reference images: edit-doc, document-check, folder-open, image, flag-goal,
  // hierarchy, roadmap (a journey with a checkpoint — good for milestones),
  // badge-check, graduation-cap.
  "edit-doc":
    '<path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7"/><path d="M8 9h6M8 12h4M8 15h3"/><path d="M19 11.5 12.5 18l-2.5.6.6-2.5 6.5-6.5a1.3 1.3 0 0 1 1.9 1.9z"/>',
  "document-check":
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="12" cy="12.5" r="3.2"/><path d="M10.7 12.6l1 1 1.7-2"/>',
  "folder-open":
    '<path d="M4 20a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2"/><path d="M2 20l3-8h18l-3 8z"/>',
  image:
    '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.7"/><path d="M4.5 18l4-5 3 3.5 3.5-4.5 4.5 6"/>',
  "flag-goal":
    '<path d="M6 21V4"/><path d="M6 5h11l-2.5 3.5L17 12H6"/>',
  hierarchy:
    '<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v6.5"/><path d="M6 17v-3.5h12v3.5"/>',
  roadmap:
    '<circle cx="6" cy="5.5" r="2.3"/><path d="M4.8 5.5l.9.9 1.5-1.8"/><path d="M8.3 5.5H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h4.2"/><path d="M12.5 17.5 14.5 19.5 12.5 21.5"/>',
  "badge-check":
    '<circle cx="12" cy="9.5" r="6"/><path d="M9.3 9.5l2 2 3.4-4"/><path d="M8.5 14.8 7 21l5-2.6 5 2.6-1.5-6.2"/>',
  "graduation-cap":
    '<path d="M2 9 12 5l10 4-10 4z"/><path d="M6 11.4V16c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8v-4.6"/><path d="M22 9v5.5"/><path d="M22 15.5a1 1 0 0 0-1 1v1.5"/>',
} as const;

export type NavIconKey = keyof typeof NAV_ICONS;

// The fallback icon for an unknown/missing key (a generic list glyph). Kept as a
// named constant so callers and tests agree on the fallback.
export const NAV_ICON_FALLBACK: NavIconKey = "items";

// Categorized icon keys for the Build-surface picker (labeled rows). The order
// here is the order the picker shows; every key in NAV_ICONS appears once.
export const NAV_ICON_GROUPS: { label: string; keys: NavIconKey[] }[] = [
  { label: "Navigation", keys: ["home", "inbox", "tasks", "search", "dashboard", "views", "navigation", "items", "recent", "starred", "archive"] },
  { label: "Content", keys: ["notes", "document", "edit-doc", "document-check", "meetings", "links", "external-link", "image", "people", "person", "song", "sermon", "paper", "book", "bookmark", "project", "mindmap"] },
  { label: "Organization", keys: ["folder", "folder-open", "tag", "collection", "filter", "layers", "grid", "table", "board", "hierarchy", "properties", "affiliate"] },
  { label: "Education", keys: ["id-card", "certificate", "assignment", "geometry", "globe", "textbook", "backpack", "graduation-cap"] },
  { label: "Tools", keys: ["tools", "bolt", "flag", "flag-goal", "roadmap", "badge-check", "bell", "download"] },
  { label: "Misc", keys: ["changelog", "calendar", "compass", "target", "heart", "trophy"] },
];

// Whether a string is a known icon key.
export function isNavIcon(key: unknown): key is NavIconKey {
  return typeof key === "string" && key in NAV_ICONS;
}

// --- The licensed AI-agent set: a SEPARATE filled family (src/lib/ai-icons.ts).
// Selected/stored as "ai:<name>" so its keyspace never collides with the stroke
// glyphs above and the renderer knows to fill (not stroke) at the 64px viewBox.
export const AI_ICON_PREFIX = "ai:";

export function isAiIconRef(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.startsWith(AI_ICON_PREFIX) &&
    Object.prototype.hasOwnProperty.call(AI_ICONS, key.slice(AI_ICON_PREFIX.length))
  );
}

// The filled path markup for an "ai:<name>" ref, or null if unknown.
export function aiIconPaths(ref: string): string | null {
  const name = ref.slice(AI_ICON_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(AI_ICONS, name) ? AI_ICONS[name] : null;
}

// Any valid STORED icon reference — a stroke-glyph key OR an "ai:" filled ref.
// Sanitizers use this (instead of isNavIcon alone) so an AI-set selection isn't
// reset to the fallback when a type/nav-slot/dashboard icon is read back.
export function isIconRef(key: unknown): key is string {
  return isNavIcon(key) || isAiIconRef(key);
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
