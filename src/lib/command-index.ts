// The universal command palette's index + ranking (ADR-063). One palette serves
// both modes (Work and Build) and searches everything: items (content, via the
// FTS API), built-in pages, saved views, item types, Build/Maintain sections,
// and named user settings. This module is the pure, node-testable core — the
// entry builders and the context-aware ranking — with no React or fetch in it.
//
// The result model is a union from the start (`destination | action`) so adding
// command-results later ("New Sermon", "Clean up unused") is a populate, not a
// refactor. Only `destination` results are produced this phase.
import { buildNavFor, CORE_BUILD_NAV } from "@/lib/build-nav";

// Which mode the palette opened in. The active mode only shifts ranking — the
// same entries are always searchable from both sides.
export type CommandMode = "work" | "build";

// Result groups, in no particular order here (display order is per-mode, see
// groupOrder). "Pages" = built-in Work pages; "Build & Settings" = Build/Maintain
// sections plus named user settings.
export const COMMAND_GROUPS = [
  "Items",
  "Pages",
  "Views",
  "Saved searches",
  "Types",
  "Build & Settings",
  "Actions",
] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export type CommandResult =
  | {
      kind: "destination";
      id: string;
      group: CommandGroup;
      label: string;
      sublabel?: string;
      href: string;
      icon: string;
      // Extra words that should find this entry, for the case where the thing
      // someone types is not what the entry is called (ADR-189: "help" and
      // "docs" must reach the User Guide). Matched exactly like the label, and
      // scored the same — a keyword hit is not a weaker hit.
      keywords?: string[];
    }
  | {
      kind: "action";
      id: string;
      group: "Actions";
      label: string;
      sublabel?: string;
      icon: string;
      actionId: string;
    };

// The builders below only ever produce destinations this phase (the action
// variant is the populate-later seam), so they return the narrowed type.
export type DestinationResult = Extract<CommandResult, { kind: "destination" }>;

// Built-in Work pages worth jumping to. These exist as routes, so none dead-links.
// Advanced search is deliberately NOT a row here: the palette carries a permanent
// footer button for it instead (CommandPalette), which is always visible and
// carries the typed query across via ?q=. A row would be a second, worse door to
// the same place — it would compete for the arrow-key selection and lose the query.
// `moduleId` marks a page that belongs to a module: it is left out while that
// module is off, so a switched-off feature leaves no door behind (ADR-272).
type StaticEntry = {
  label: string;
  href: string;
  icon: string;
  keywords?: string[];
  moduleId?: string;
};

const BUILTIN_PAGES: StaticEntry[] = [
  { label: "Home", href: "/", icon: "home", keywords: ["start"] },
  { label: "Today", href: "/today", icon: "calendar", keywords: ["agenda", "day"] },
  { label: "Inbox", href: "/inbox", icon: "inbox" },
  { label: "Triage", href: "/inbox/triage", icon: "inbox", keywords: ["process inbox", "one at a time"], moduleId: "triage" },
  { label: "Tasks", href: "/tasks", icon: "tasks", keywords: ["to do", "todo"] },
  { label: "Planner", href: "/planner", icon: "calendar", keywords: ["calendar", "schedule", "time block"] },
  { label: "Desk", href: "/desk", icon: "grid", keywords: ["workspace", "panels"], moduleId: "desk" },
  { label: "Notifications", href: "/notifications", icon: "bell", keywords: ["alerts"], moduleId: "notification-center" },
  { label: "Notes", href: "/notes", icon: "notes" },
  { label: "Links", href: "/links", icon: "links", keywords: ["bookmarks"] },
  { label: "Events", href: "/events", icon: "meetings", keywords: ["meetings"] },
  { label: "Dashboards", href: "/dashboards", icon: "dashboard" },
  { label: "Views", href: "/views", icon: "views", keywords: ["saved views"] },
  { label: "Types directory", href: "/list", icon: "layers", keywords: ["types", "all types"] },
  { label: "All items", href: "/items", icon: "items" },
  { label: "Search page", href: "/search", icon: "search", keywords: ["advanced search", "search"] },
  { label: "Trash", href: "/trash", icon: "archive", keywords: ["deleted", "restore"] },
  { label: "Changelog", href: "/changelog", icon: "changelog", keywords: ["what's new", "release notes"] },
  { label: "New type", href: "/build/types/new", icon: "layers", keywords: ["create type", "add type"] },
  { label: "New view", href: "/views/new", icon: "views", keywords: ["create view", "add view"] },
  { label: "New template", href: "/build/templates/new", icon: "document", keywords: ["create template", "add template"] },
];

// Named user settings. Each jumps to its group's anchor on /settings, so
// "trash retention" lands on Connections & data rather than the page top.
type SettingEntry = { label: string; icon: string; anchor: string; keywords?: string[]; moduleId?: string };
const SETTINGS_ENTRIES: SettingEntry[] = [
  // The groups themselves, so a section name lands on its heading.
  { label: "Account", icon: "person", anchor: "account" },
  { label: "Appearance", icon: "tools", anchor: "appearance" },
  { label: "Layout", icon: "grid", anchor: "layout" },
  { label: "Editing", icon: "tools", anchor: "editing" },
  { label: "Search settings", icon: "search", anchor: "search" },
  { label: "Notification settings", icon: "bell", anchor: "notifications", moduleId: "notification-center" },
  { label: "AI settings", icon: "bolt", anchor: "ai" },
  { label: "Connections & data", icon: "tools", anchor: "connections" },
  // The rows inside them.
  { label: "Display name", icon: "person", anchor: "account" },
  { label: "Timezone", icon: "person", anchor: "account" },
  { label: "Sign-in and password", icon: "person", anchor: "sign-in" },
  { label: "Theme", icon: "tools", anchor: "appearance", keywords: ["dark mode", "light mode"] },
  { label: "Highlight color", icon: "tools", anchor: "appearance", keywords: ["accent color"] },
  { label: "Text size", icon: "tools", anchor: "appearance", keywords: ["font size"] },
  { label: "Display density", icon: "tools", anchor: "appearance", keywords: ["compact"] },
  { label: "Section style", icon: "tools", anchor: "appearance" },
  { label: "Navigation position", icon: "grid", anchor: "layout", keywords: ["nav position"] },
  { label: "Spacing", icon: "grid", anchor: "layout" },
  { label: "Opening an item", icon: "grid", anchor: "layout", keywords: ["open in modal", "open in page"] },
  { label: "Quick-add card", icon: "tools", anchor: "editing" },
  { label: "Editor toolbar", icon: "tools", anchor: "editing" },
  { label: "Collapsible headings", icon: "tools", anchor: "editing" },
  { label: "Toggle blocks", icon: "tools", anchor: "editing" },
  { label: "Search dictionary", icon: "tools", anchor: "search", keywords: ["synonyms"] },
  { label: "Morning agenda", icon: "bell", anchor: "notifications", moduleId: "notification-center" },
  { label: "Event prep ready", icon: "bell", anchor: "notifications", moduleId: "notification-center" },
  { label: "Task due", icon: "bell", anchor: "notifications", moduleId: "notification-center" },
  { label: "Event starting soon", icon: "bell", anchor: "notifications", moduleId: "notification-center" },
  { label: "Sync & system errors", icon: "bell", anchor: "notifications", moduleId: "notification-center" },
  { label: "AI features", icon: "bolt", anchor: "ai" },
  { label: "Note Editing Partner prompt", icon: "bolt", anchor: "ai", moduleId: "live-context" },
  { label: "Trash retention", icon: "archive", anchor: "connections" },
  { label: "Task calendar feed", icon: "tools", anchor: "calendar-feed", keywords: ["ics"] },
  { label: "API credentials", icon: "tools", anchor: "api-credentials" },
];

// The static (data-independent) entries: pages, Build/Maintain sections, and
// named settings. Build sections come straight from build-nav.ts so the palette
// and the sidebar never drift. `off` is the owner's switched-off module ids;
// pass `null` while they are still loading, which leaves out every module entry
// so a disabled module never flashes into the list (ADR-272).
export function staticCommandEntries(off: readonly string[] | null = []): DestinationResult[] {
  const on = (moduleId?: string) => !moduleId || (off !== null && !off.includes(moduleId));
  const pages: DestinationResult[] = BUILTIN_PAGES.filter((p) => on(p.moduleId)).map((p) => ({
    kind: "destination",
    id: `page:${p.href}`,
    group: "Pages",
    label: p.label,
    href: p.href,
    icon: p.icon,
    keywords: p.keywords,
  }));
  // buildNavFor(off) is the same filtered taxonomy the sidebar renders. While
  // `off` is unknown, only the core entries.
  const buildEntries = (off === null ? CORE_BUILD_NAV : buildNavFor(off)).flatMap((g) => g.entries);
  const sections: DestinationResult[] = buildEntries.map((e) => ({
    kind: "destination",
    id: `section:${e.href}`,
    group: "Build & Settings",
    label: e.label,
    sublabel: "Build",
    href: e.href,
    icon: e.icon,
    keywords: e.keywords,
  }));
  const settings: DestinationResult[] = SETTINGS_ENTRIES.filter((s) => on(s.moduleId)).map((s) => ({
    kind: "destination",
    id: `setting:${s.label}`,
    group: "Build & Settings",
    label: s.label,
    sublabel: "User Settings",
    href: `/settings#${s.anchor}`,
    icon: s.icon,
    keywords: s.keywords,
  }));
  return [...pages, ...sections, ...settings];
}

// The dynamic entries from owner data. A type's name always opens its home
// page (its item list), in both modes, so typing a type's exact name lands
// there; Build mode adds a second "Edit <type>" row for the type editor. Hidden
// types are included (they drop out of everyday nav, but typing the name is
// deliberate). Views open to run; a dashboard opens itself; a template opens
// its prototype item's canvas — the same target the templates index links to
// (ADR-093), since a template *is* a real item and has no separate editor.
export function dynamicCommandEntries(
  data: {
    types: { key: string; label: string; icon: string | null; hidden?: boolean }[];
    views: { id: string; name: string }[];
    dashboards?: { id: string; name: string }[];
    templates: {
      id: string;
      name: string;
      type: string;
      prototypeItemId: string;
    }[];
    savedSearches: { id: string; name: string }[];
  },
  mode: CommandMode
): DestinationResult[] {
  const types: DestinationResult[] = data.types.flatMap((t): DestinationResult[] => {
    const home: DestinationResult = {
      kind: "destination",
      id: `type:${t.key}`,
      group: "Types",
      label: t.label,
      sublabel: t.hidden ? "Hidden type · View items" : "View items",
      href: `/list/${t.key}`,
      icon: t.icon ?? "layers",
    };
    if (mode !== "build") return [home];
    return [
      home,
      {
        kind: "destination",
        id: `type-edit:${t.key}`,
        group: "Types",
        label: `Edit ${t.label}`,
        sublabel: "Edit type",
        href: `/build/types/${t.key}/edit`,
        icon: t.icon ?? "layers",
      },
    ];
  });
  const dashboards: DestinationResult[] = (data.dashboards ?? []).map((d) => ({
    kind: "destination",
    id: `dashboard:${d.id}`,
    group: "Views",
    label: d.name,
    sublabel: "Dashboard",
    href: `/dashboards/${d.id}`,
    icon: "dashboard",
  }));
  const views: DestinationResult[] = data.views.map((v) => ({
    kind: "destination",
    id: `view:${v.id}`,
    group: "Views",
    label: v.name,
    href: `/views/${v.id}`,
    icon: "views",
  }));
  const templates: DestinationResult[] = data.templates.map((t) => ({
    kind: "destination",
    id: `template:${t.id}`,
    group: "Build & Settings",
    label: t.name,
    sublabel: `Template · ${t.type}`,
    href: `/items/${t.prototypeItemId}`,
    icon: "document",
  }));
  const savedSearches: DestinationResult[] = data.savedSearches.map((s) => ({
    kind: "destination",
    id: `saved-search:${s.id}`,
    group: "Saved searches",
    label: s.name,
    href: `/search?saved=${s.id}`,
    icon: "search",
  }));
  return [...types, ...views, ...dashboards, ...templates, ...savedSearches];
}

// Match a query against a label. Higher is better; null means no match. Prefix
// beats word-boundary beats substring beats all-tokens-present, so "inb" surfaces
// Inbox above an item whose body merely contains "inbox".
export function matchScore(label: string, q: string): number | null {
  const l = label.toLowerCase();
  const query = q.trim().toLowerCase();
  if (!query) return 0;
  // An exact name outranks a prefix, so "task" picks the Task type over Tasks.
  if (l === query) return 120;
  if (l.startsWith(query)) return 100;
  // Word-boundary prefix (e.g. "settings" matches "User Settings").
  if (l.split(/[\s&/·]+/).some((w) => w.startsWith(query))) return 80;
  if (l.includes(query)) return 55;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => l.includes(t))) return 35;
  return null;
}

// Per-mode group weight: in Work, content (items/pages/views) ranks higher; in
// Build, sections/settings/types do. Added to the match score so ranking shifts
// with the active mode without changing what's searchable.
function groupWeight(group: CommandGroup, mode: CommandMode): number {
  const work: Record<CommandGroup, number> = {
    Items: 30,
    Pages: 25,
    Views: 20,
    "Saved searches": 18,
    Types: 10,
    "Build & Settings": 5,
    Actions: 0,
  };
  const build: Record<CommandGroup, number> = {
    "Build & Settings": 30,
    Types: 25,
    Views: 15,
    "Saved searches": 12,
    Items: 10,
    Pages: 8,
    Actions: 0,
  };
  return (mode === "build" ? build : work)[group];
}

// The display order of groups for a mode (Items-first in Work, Build-first in
// Build). Groups with no matches are simply skipped by the renderer. When a
// non-item entry's name is exactly the query, its group moves to the front so
// Enter opens it: typing a type's (or page's) exact name goes straight there.
export function groupOrder(mode: CommandMode, ranked: CommandResult[] = [], q = ""): CommandGroup[] {
  const base: CommandGroup[] =
    mode === "build"
      ? ["Build & Settings", "Types", "Views", "Saved searches", "Items", "Pages", "Actions"]
      : ["Items", "Pages", "Views", "Saved searches", "Types", "Build & Settings", "Actions"];
  const query = q.trim().toLowerCase();
  const exact = query ? ranked.find((r) => r.label.toLowerCase() === query) : undefined;
  return exact ? [exact.group, ...base.filter((g) => g !== exact.group)] : base;
}

// Rank a set of entries against the query for a mode. With an empty query the
// entries pass through unscored (the palette shows a capped jump-list on open);
// otherwise unmatched entries drop out and the rest sort by score within their
// group. Items are ranked elsewhere (they come pre-ranked from the FTS API), so
// pass only the non-item entries here.
export function rankCommands(
  entries: CommandResult[],
  q: string,
  mode: CommandMode
): CommandResult[] {
  const query = q.trim();
  if (!query) return entries;
  return entries
    .map((e) => {
      // Best of the label and any keyword aliases, so "help" reaches an entry
      // labelled "User Guide" without a second row pointing at the same route.
      const scores = [
        matchScore(e.label, query),
        ...(e.kind === "destination" && e.keywords
          ? e.keywords.map((k) => matchScore(k, query))
          : []),
      ].filter((s): s is number => s != null);
      if (scores.length === 0) return null;
      return { e, score: Math.max(...scores) + groupWeight(e.group, mode) };
    })
    .filter((x): x is { e: CommandResult; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label))
    .map((x) => x.e);
}
