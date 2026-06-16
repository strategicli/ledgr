// The Build-mode left sidebar structure (ADR-063): the hardcoded taxonomy of
// the system tools, grouped under three verbs — DATA (build the data model),
// INTERFACE (build how you see and reach it), MAINTAIN (understand and care for
// what exists). This is the single source of truth for two surfaces:
//
//   1. BuildSidebar renders these groups + entries directly.
//   2. The Work nav's destination picker offers them as a "Build tools" category
//      (buildToolDests below), so a power user can pull any Build tool into their
//      daily Work nav — the "separation is the default, not a wall" principle.
//
// Kept as data with no JSX (the nav-slot-options pattern) so both a server page
// and the client sidebar can read it. Icon keys come from the shared nav-icons
// library. The sidebar is a system surface, not user-configurable (no DB row).
import type { NavIconKey } from "@/lib/nav-icons";

export type BuildGroupLabel = "DATA" | "INTERFACE" | "MAINTAIN";

export type BuildEntry = {
  label: string;
  href: string;
  icon: NavIconKey;
  // Most entries are flat links. `expandable` marks the few with genuine
  // sub-navigation (Vercel discipline: dropdowns sparingly). The dynamic ones
  // (Types → the user's actual types) inject children at render; the rest grow
  // their sub-nav in later phases (see the stub plan-notes).
  expandable?: boolean;
};

export type BuildGroup = {
  label: BuildGroupLabel;
  entries: BuildEntry[];
};

// The three groups, in display order. These exact labels render in the UI.
export const BUILD_NAV: BuildGroup[] = [
  {
    label: "DATA",
    entries: [
      // Types & Properties is the one entry that expands this phase: its
      // dropdown lists the user's actual types for a quick edit-jump.
      { label: "Types & Properties", href: "/build/types", icon: "layers", expandable: true },
      { label: "Templates", href: "/build/templates", icon: "document" },
      { label: "Workflows & Wikis", href: "/build/new", icon: "board" },
      { label: "Bespoke Tools", href: "/build/tools", icon: "bolt" },
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
      { label: "Data Hygiene", href: "/build/hygiene", icon: "filter" },
      { label: "Import & Migration", href: "/build/import", icon: "folder" },
      // Labelled "AI & MCP", not "Claude": the MCP server is client-agnostic
      // (any MCP-speaking AI can connect), so the surface name stays generic
      // even though Claude is the reference client. Route slug stays /claude.
      { label: "AI & MCP", href: "/build/claude", icon: "bolt" },
      // The one deliberate both-places entry: also reachable from the Work kebab
      // so personal/cosmetic settings don't require entering Build. Label stays
      // "User Settings" everywhere (never bare "Settings").
      { label: "User Settings", href: "/settings", icon: "tools" },
    ],
  },
];

// Every Build entry as a flat list (group order preserved), for the destination
// picker's "Build tools" category and the command palette's section index.
export const BUILD_ENTRIES: BuildEntry[] = BUILD_NAV.flatMap((g) => g.entries);

// True for any route that renders within the Build surface (so NavShell shows
// the Build sidebar). Model Overview is `/build` exactly; everything else is a
// `/build/...` child. Dashboards (`/dashboards*`) are an INTERFACE-building
// surface reached from the Build sidebar, so they keep the Build chrome too —
// you manage/build a dashboard in Build. (A dashboard *assigned* as the Home or
// Today surface renders at `/` or `/today`, which stay Work chrome — that's the
// "using it" context, not the "building it" one.) `/settings` is reachable from
// both sides, so it is NOT treated as Build chrome (it keeps the Work nav when
// reached from the Work kebab); the sidebar's User Settings entry links to it.
export function isBuildPath(pathname: string): boolean {
  return (
    pathname === "/build" ||
    pathname.startsWith("/build/") ||
    pathname === "/dashboards" ||
    pathname.startsWith("/dashboards/")
  );
}
