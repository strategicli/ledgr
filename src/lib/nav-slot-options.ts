// The destination options the nav-slot editor offers (ADR-056): built-in app
// pages, the owner's saved views, and the item types. A slot's "Points to"
// dropdown is built from these; picking one prefills the slot's href/kind/label/
// icon. Kept as data (no JSX) so the server page can assemble the list and hand
// it to the client editor.
//
// Only routes that actually exist are offered, so a configured slot never
// dead-links. `badgeEligible` marks the one destination (Inbox) that can show a
// count badge for now.
import { isNavIcon } from "@/lib/nav-icons";
import type { NavDestKind } from "@/lib/settings";

export type DestGroup = "Built-in" | "Views" | "Types";

export type DestOption = {
  group: DestGroup;
  kind: NavDestKind;
  href: string;
  label: string;
  icon: string;
  badgeEligible: boolean;
};

// The built-in pages that make sense as daily-nav destinations. Views/Items live
// here too (they exist as routes); Archive is intentionally absent — there's no
// /archive route yet, so offering it would dead-link.
export const BUILTIN_DESTS: DestOption[] = [
  { group: "Built-in", kind: "builtin", href: "/inbox", label: "Inbox", icon: "inbox", badgeEligible: true },
  { group: "Built-in", kind: "builtin", href: "/tasks", label: "Tasks", icon: "tasks", badgeEligible: false },
  { group: "Built-in", kind: "builtin", href: "/search", label: "Search", icon: "search", badgeEligible: false },
  { group: "Built-in", kind: "builtin", href: "/dashboard", label: "Dashboard", icon: "dashboard", badgeEligible: false },
  { group: "Built-in", kind: "builtin", href: "/items", label: "Items", icon: "items", badgeEligible: false },
  { group: "Built-in", kind: "builtin", href: "/views", label: "Views", icon: "views", badgeEligible: false },
];

export function buildDestOptions(
  views: { id: string; name: string }[],
  types: { key: string; label: string; icon: string | null }[]
): DestOption[] {
  return [
    ...BUILTIN_DESTS,
    ...views.map((v) => ({
      group: "Views" as const,
      kind: "view" as const,
      href: `/views/${v.id}`,
      label: v.name,
      icon: "views",
      badgeEligible: false,
    })),
    ...types.map((t) => ({
      group: "Types" as const,
      kind: "type" as const,
      href: `/list/${t.key}`,
      label: t.label,
      icon: isNavIcon(t.icon) ? t.icon : "items",
      badgeEligible: false,
    })),
  ];
}

// Find the option a stored href points at (to resolve badge-eligibility and the
// current dropdown selection). Returns undefined for an orphaned href (e.g. a
// view that was since deleted) — the slot still renders from its stored fields.
export function findDestOption(
  options: DestOption[],
  href: string
): DestOption | undefined {
  return options.find((o) => o.href === href);
}
