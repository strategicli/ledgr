// Per-owner UI settings (v5). A single jsonb blob on the users row so each new
// preference isn't a migration. Validated/defaulted on read so a hand-edited or
// partial blob always yields a complete, safe object. Owner-scoped like
// everything else. Surfaces: the highlight-accent color (themed via a CSS var),
// the Trash retention window, and the nav position.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";

// The accent palette offered in settings. Stored as the hex so it can drop
// straight into the `--accent` CSS variable.
export const HIGHLIGHT_COLORS = [
  { name: "Blue", value: "#2563eb" },
  { name: "Violet", value: "#7c3aed" },
  { name: "Emerald", value: "#059669" },
  { name: "Amber", value: "#d97706" },
  { name: "Rose", value: "#e11d48" },
  { name: "Slate", value: "#475569" },
] as const;

export const NAV_POSITIONS = ["top", "bottom", "left", "right"] as const;
export type NavPosition = (typeof NAV_POSITIONS)[number];

// Width of the left/right side rail. Only meaningful when navPosition is
// left or right: "fat" shows icons + names, "thin" is an icon-only rail,
// "hidden" rolls it up to a sliver tab at the screen edge. The nav's collapse
// arrow cycles fat → thin → hidden.
export const RAIL_SIZES = ["fat", "thin", "hidden"] as const;
export type RailSize = (typeof RAIL_SIZES)[number];

// How the nav items pack into the bar/rail. "spread" pins them to the edges
// (nav slots one end, the New/More utilities the other, filling the space);
// "compact" groups everything together. On the top bar, compact also constrains
// the content to the ~40rem canvas width. The bottom bar is always compact.
export const NAV_DENSITIES = ["spread", "compact"] as const;
export type NavDensity = (typeof NAV_DENSITIES)[number];

// For a compact left/right rail: where the grouped cluster sits vertically —
// the top edge, the bottom edge, or centered. Ignored when spread, and on the
// top/bottom bars.
export const RAIL_ANCHORS = ["top", "bottom", "center"] as const;
export type RailAnchor = (typeof RAIL_ANCHORS)[number];

export type UserSettings = {
  highlightColor: string; // hex from HIGHLIGHT_COLORS
  trashRetentionDays: number; // 1..365
  navPosition: NavPosition;
  railSize: RailSize;
  navDensity: NavDensity;
  railAnchor: RailAnchor;
  // How this owner signs shared content (the Changelog notes "Sign" stamp).
  // Empty falls back to the email's local part (see effectiveDisplayName).
  displayName: string;
};

export const DEFAULT_SETTINGS: UserSettings = {
  highlightColor: "#2563eb",
  trashRetentionDays: 30,
  navPosition: "bottom",
  railSize: "fat",
  navDensity: "spread",
  railAnchor: "top",
  displayName: "",
};

export function parseSettings(raw: unknown): UserSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const highlightColor = HIGHLIGHT_COLORS.some((c) => c.value === r.highlightColor)
    ? (r.highlightColor as string)
    : DEFAULT_SETTINGS.highlightColor;
  const days = typeof r.trashRetentionDays === "number" && r.trashRetentionDays > 0
    ? Math.min(Math.round(r.trashRetentionDays), 365)
    : DEFAULT_SETTINGS.trashRetentionDays;
  const navPosition = (NAV_POSITIONS as readonly string[]).includes(r.navPosition as string)
    ? (r.navPosition as NavPosition)
    : DEFAULT_SETTINGS.navPosition;
  const railSize = (RAIL_SIZES as readonly string[]).includes(r.railSize as string)
    ? (r.railSize as RailSize)
    : DEFAULT_SETTINGS.railSize;
  const navDensity = (NAV_DENSITIES as readonly string[]).includes(r.navDensity as string)
    ? (r.navDensity as NavDensity)
    : DEFAULT_SETTINGS.navDensity;
  const railAnchor = (RAIL_ANCHORS as readonly string[]).includes(r.railAnchor as string)
    ? (r.railAnchor as RailAnchor)
    : DEFAULT_SETTINGS.railAnchor;
  const displayName =
    typeof r.displayName === "string" ? r.displayName.trim().slice(0, 60) : DEFAULT_SETTINGS.displayName;
  return { highlightColor, trashRetentionDays: days, navPosition, railSize, navDensity, railAnchor, displayName };
}

// The name to sign with: the explicit setting, else a readable fallback from
// the email's local part ("tyler@…" -> "Tyler"). Each instance is one owner.
export function effectiveDisplayName(settings: UserSettings, email: string): string {
  if (settings.displayName) return settings.displayName;
  const local = (email.split("@")[0] || "").replace(/[._-]+/g, " ").trim();
  if (!local) return "Someone";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export async function getSettings(ownerId: string): Promise<UserSettings> {
  const [row] = await getDb()
    .select({ settings: users.settings })
    .from(users)
    .where(eq(users.id, ownerId));
  return parseSettings(row?.settings);
}

export async function updateSettings(
  ownerId: string,
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const next = parseSettings({ ...(await getSettings(ownerId)), ...patch });
  await getDb().update(users).set({ settings: next }).where(eq(users.id, ownerId));
  return next;
}
