// The Build-mode left sidebar structure (ADR-063): the hardcoded taxonomy of
// the system tools, grouped under four verbs — DATA (build the data model),
// INTERFACE (build how you see and reach it), MAINTAIN (understand and care for
// what exists), SYSTEM (the software and the machine it runs on). This is the
// single source of truth for two surfaces:
//
//   1. BuildSidebar renders these groups + entries directly.
//   2. The Work nav's destination picker offers them as a "Build tools" category
//      (buildToolDests below), so a power user can pull any Build tool into their
//      daily Work nav — the "separation is the default, not a wall" principle.
//
// Kept as data with no JSX (the nav-slot-options pattern) so both a server page
// and the client sidebar can read it. Icon keys come from the shared nav-icons
// library. The sidebar is a system surface, not user-configurable (no DB row).
//
// Modules add entries of their own through the manifest `nav` slot (ADR-272
// step 3). `CORE_BUILD_NAV` is the static core taxonomy; `buildNavFor(off)`
// merges in every module's entries except the switched-off ones, and is what
// the sidebar and the picker render. The registry is pure data, so importing it
// here is safe in the browser.
import type { NavIconKey } from "@/lib/nav-icons";
import { navEntriesForModules } from "@/lib/modules";
import "@/lib/modules/register";

export type BuildGroupLabel = "DATA" | "INTERFACE" | "MAINTAIN" | "SYSTEM";

export type BuildEntry = {
  label: string;
  href: string;
  icon: NavIconKey;
  // Most entries are flat links. `expandable` marks the few with genuine
  // sub-navigation (Vercel discipline: dropdowns sparingly). The dynamic ones
  // (Types → the user's actual types) inject children at render; the rest grow
  // their sub-nav in later phases (see the stub plan-notes).
  expandable?: boolean;
  // Extra search words for the command palette, when what a person types isn't
  // what the entry is called ("help" → User Guide). Sidebar ignores these.
  keywords?: string[];
};

export type BuildGroup = {
  label: BuildGroupLabel;
  entries: BuildEntry[];
};

// The four core groups, in display order. These exact labels render in the UI.
export const CORE_BUILD_NAV: BuildGroup[] = [
  {
    label: "DATA",
    entries: [
      // Types & Properties is the one entry that expands this phase: its
      // dropdown lists the user's actual types for a quick edit-jump.
      { label: "Types & Properties", href: "/build/types", icon: "layers", expandable: true },
      { label: "Templates", href: "/build/templates", icon: "document" },
      { label: "Workflows & Wikis", href: "/build/new", icon: "board" },
      { label: "Bespoke Tools", href: "/build/tools", icon: "bolt" },
      // The storage browser (ADR-237): every uploaded file, its item, and
      // whether the item still points at it. Data, not maintenance — files are
      // content the owner owns, not a mess to clean (that's hygiene's sweep).
      { label: "Files", href: "/build/files", icon: "folder" },
      // Capture & Inbox (ADR-249): where each arrival path lands — queued in the
      // Inbox, filed straight away, or dropped into a project — plus the web
      // clipper setup, moved here from the bottom of User Settings so "how does
      // stuff get into Ledgr" has one address. DATA, not MAINTAIN: capture
      // routing shapes what data exists.
      {
        label: "Capture & Inbox",
        href: "/build/capture",
        icon: "inbox",
        keywords: ["capture", "inbox", "clipper", "routing", "source", "email", "todoist"],
      },
    ],
  },
  {
    label: "INTERFACE",
    entries: [
      { label: "Views", href: "/build/views", icon: "views" },
      { label: "Dashboards", href: "/dashboards", icon: "dashboard" },
      { label: "Navigation", href: "/build/navigation", icon: "navigation" },
    ],
  },
  {
    label: "MAINTAIN",
    entries: [
      // Model Overview is the /build home — the bird's-eye view you land on.
      { label: "Model Overview", href: "/build", icon: "compass" },
      // Modules (ADR-272): the per-owner on/off switch for each workflow module.
      {
        label: "Modules",
        href: "/build/modules",
        icon: "grid",
        keywords: ["features", "enable", "disable", "turn off", "songs", "papers"],
      },
      // User Guide (ADR-189): what Ledgr can do and where each feature lives.
      // Sits next to Model Overview because the pair answers the two "what have
      // I got" questions — that one for your data, this one for the tool. Also
      // linked from the Work "More" menu and findable in the command palette,
      // since the problem it solves is not knowing a feature exists at all.
      {
        label: "User Guide",
        href: "/build/guide",
        icon: "book",
        keywords: ["help", "docs", "documentation", "manual", "how to"],
      },
      { label: "Data Hygiene", href: "/build/hygiene", icon: "filter" },
      // (Loose Ends, /build/loose-ends, lands here from the relatedness
      // module's manifest while that module is on.)
      { label: "Import & Migration", href: "/build/import", icon: "download" },
      // Labelled "AI & MCP", not "Claude": the MCP server is client-agnostic
      // (any MCP-speaking AI can connect), so the surface name stays generic
      // even though Claude is the reference client. Route slug stays /claude.
      { label: "AI & MCP", href: "/build/claude", icon: "bolt" },
      // API Tokens (ADR-179): tokens for non-AI callers — an external app that
      // pushes data in over /api/machine/*. Its own entry rather than a section
      // on AI & MCP, because "give my app an API token" doesn't read as an AI
      // task; the previous home (User Settings → Save from the web) was
      // effectively undiscoverable for that.
      { label: "API", href: "/build/api", icon: "tools" },
      // (AI Memory, /build/memory, lands here from the ai-memory module's
      // manifest while that module is on.)
      // The one deliberate both-places entry: also reachable from the Work kebab
      // so personal/cosmetic settings don't require entering Build. Label stays
      // "User Settings" everywhere (never bare "Settings").
      { label: "User Settings", href: "/settings", icon: "tools" },
    ],
  },
  // SYSTEM = the software and the machine it runs on (updates, network,
  // scheduled jobs, backups), split out of MAINTAIN 2026-09-12 because those
  // four are about running Ledgr, not caring for the data in it.
  {
    label: "SYSTEM",
    entries: [
      // Updates: is this instance running the latest Ledgr, and has its database
      // caught up with the code it's running? It earns a doorway of its own
      // rather than a corner of the Changelog: the Changelog answers "what
      // changed", this answers "am I behind", and only the second one has a
      // button.
      {
        label: "Updates",
        href: "/build/updates",
        icon: "repeat",
        keywords: ["update", "upgrade", "version", "migrate", "latest"],
      },
      // Network (ADR-209): the sync topology — hubs this instance syncs TO,
      // devices that sync FROM it. Split out of Updates the moment a third
      // node made two buried sections illegible.
      {
        label: "Network",
        href: "/build/network",
        icon: "affiliate",
        keywords: ["sync", "hub", "spoke", "device", "peer", "topology", "replication"],
      },
      {
        label: "Scheduled Jobs",
        href: "/build/jobs",
        icon: "repeat",
        keywords: ["jobs", "cron", "schedule", "transcripts", "youtube", "export", "owner"],
      },
      {
        label: "Backups",
        href: "/build/backups",
        icon: "download",
        keywords: ["backup", "snapshot", "restore", "recovery"],
      },
    ],
  },
];

// The core groups with module entries merged in, leaving out the modules in
// `off` (the owner's switched-off ids, `offModuleIds`). A module entry goes
// right after the core entry its `after` names, in registration order, else at
// the end of its group. Core entries never move.
export function buildNavFor(off: readonly string[] = []): BuildGroup[] {
  const extra = navEntriesForModules(off);
  const toEntry = (e: (typeof extra)[number]): BuildEntry => ({
    label: e.label,
    href: e.href,
    icon: e.icon as NavIconKey,
    keywords: e.keywords,
  });
  return CORE_BUILD_NAV.map((g) => {
    const mine = extra.filter((e) => e.group === g.label);
    const anchored = new Set(g.entries.map((c) => c.href));
    return {
      label: g.label,
      entries: [
        ...g.entries.flatMap((c) => [c, ...mine.filter((e) => e.after === c.href).map(toEntry)]),
        ...mine.filter((e) => !e.after || !anchored.has(e.after)).map(toEntry),
      ],
    };
  });
}

// Every registered module's entries included, on or off: the full taxonomy the
// command palette and describe_workspace index. The sidebar and the picker use
// `buildNavFor(offModules)` instead, so a switched-off module's page drops out.
export const BUILD_NAV: BuildGroup[] = buildNavFor();

// Every Build entry as a flat list (group order preserved), for the command
// palette's section index.
export const BUILD_ENTRIES: BuildEntry[] = BUILD_NAV.flatMap((g) => g.entries);

// True for any route that renders within the Build surface (so NavShell shows
// the Build sidebar). Model Overview is `/build` exactly; everything else is a
// `/build/...` child. The dashboards INDEX (`/dashboards`, the management
// surface: rename/duplicate/delete/reorder + Home/Today assignment) is Build
// chrome; an INDIVIDUAL dashboard (`/dashboards/<id>`) is the "using it"
// context and keeps Work chrome — the destination picker offers dashboards as
// Work-nav slots, and Home/Today already render the same grid under Work
// chrome. (Claiming `/dashboards/...` as Build here is what once made Build
// mode the only way to view an unassigned dashboard.) `/settings` is reachable
// from both sides, so it is NOT treated as Build chrome (it keeps the Work nav
// when reached from the Work kebab); the sidebar's User Settings entry links
// to it.
export function isBuildPath(pathname: string): boolean {
  return (
    pathname === "/build" ||
    pathname.startsWith("/build/") ||
    pathname === "/dashboards"
  );
}
