// Per-owner UI settings (v5). A single jsonb blob on the users row so each new
// preference isn't a migration. Validated/defaulted on read so a hand-edited or
// partial blob always yields a complete, safe object. Owner-scoped like
// everything else. Surfaces: the highlight-accent color (themed via a CSS var),
// the Trash retention window, and the nav position.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { isNavIcon, NAV_ICON_FALLBACK } from "@/lib/nav-icons";

// The accent palette offered in settings. Stored as the hex so it can drop
// straight into the `--accent` CSS variable.
export const HIGHLIGHT_COLORS = [
  { name: "Red", value: "#dc2626" },
  { name: "Rose", value: "#e11d48" },
  { name: "Pink", value: "#db2777" },
  { name: "Fuchsia", value: "#c026d3" },
  { name: "Violet", value: "#7c3aed" },
  { name: "Indigo", value: "#4f46e5" },
  { name: "Blue", value: "#2563eb" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Cyan", value: "#0891b2" },
  { name: "Teal", value: "#0d9488" },
  { name: "Emerald", value: "#059669" },
  { name: "Lime", value: "#65a30d" },
  { name: "Amber", value: "#d97706" },
  { name: "Orange", value: "#ea580c" },
  { name: "Slate", value: "#475569" },
] as const;

// Gradient accents (an alternative to the solid HIGHLIGHT_COLORS). A CSS
// gradient is an image, not a color, so it can't drive `color`/`border-color`/
// box-shadow/`color-mix` the way a solid hex can. Each gradient therefore ships
// a representative solid `accent` (used for `--accent`, so text/borders/glows
// stay valid) alongside the gradient `value` (used for `--accent-gradient`,
// applied to accent *fills* like checkboxes and count badges).
export const HIGHLIGHT_GRADIENTS = [
  { name: "Sunset", value: "linear-gradient(135deg, #fb923c 0%, #ec4899 100%)", accent: "#f472b6" },
  { name: "Ember", value: "linear-gradient(135deg, #ef4444 0%, #f97316 100%)", accent: "#fb6a3c" },
  { name: "Gold", value: "linear-gradient(135deg, #fbbf24 0%, #f97316 100%)", accent: "#f59e0b" },
  { name: "Emerald", value: "linear-gradient(135deg, #34d399 0%, #0d9488 100%)", accent: "#10b981" },
  { name: "Lagoon", value: "linear-gradient(135deg, #2dd4bf 0%, #3b82f6 100%)", accent: "#0ea5e9" },
  { name: "Ocean", value: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)", accent: "#3b82f6" },
  { name: "Aurora", value: "linear-gradient(135deg, #22d3ee 0%, #a855f7 100%)", accent: "#818cf8" },
  { name: "Grape", value: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)", accent: "#c026d3" },
] as const;

// Every accent solid that's valid for `--accent`: the named solids plus each
// gradient's representative accent (chosen when a gradient is active).
const ALLOWED_ACCENTS = new Set<string>([
  ...HIGHLIGHT_COLORS.map((c) => c.value),
  ...HIGHLIGHT_GRADIENTS.map((g) => g.accent),
]);

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
// "compact" groups everything together and anchors the cluster (see
// RailAnchor). The bottom bar is always compact.
export const NAV_DENSITIES = ["spread", "compact"] as const;
export type NavDensity = (typeof NAV_DENSITIES)[number];

// For a compact rail or top bar: where the grouped cluster sits along the bar's
// long axis. On a left/right rail that axis is vertical (top / center / bottom
// edge); on the top bar it's horizontal, where top/center/bottom read as
// left/center/right (the same start/center/end idea). Ignored when spread, and
// on the bottom bar.
export const RAIL_ANCHORS = ["top", "bottom", "center"] as const;
export type RailAnchor = (typeof RAIL_ANCHORS)[number];

// --- Configurable nav slots (ADR-056) -------------------------------------
// The nav bar has three zones: a locked Home (always first), the configurable
// middle slots stored here, then locked New + More (added at render time, never
// stored). A middle slot is either a single `destination` (one route) or a
// `tools` group (a button that opens a popover of child destinations).
//
// Stored in the users.settings jsonb (no migration). parseNavSlots is tolerant:
// a malformed slot is dropped and an unknown icon falls back, so a hand-edited
// blob still yields a safe, complete list rather than throwing.

// Recommended slot counts — guidance, not hard limits. They're sized for the
// tight surfaces: the desktop floating pill and the phone bottom bar. A left/
// right rail or the top bar have far more room, so the editor surfaces these as
// advice (dims the overflow in the preview, shows a hint) and lets the user
// exceed them rather than blocking. A single generous hard ceiling still bounds
// the stored array so a hand-edited blob can't produce an unbounded nav.
export const RECOMMENDED_NAV_SLOTS = 5;
export const RECOMMENDED_MOBILE_NAV_SLOTS = 4;
export const NAV_SLOTS_HARD_CAP = 20;
export const MAX_TOOLS_CHILDREN = 8;

// A destination points at one route. `builtin` is a hardcoded app page, `view`
// a saved view (/views/[id]), `type` a type's list (/list/[key]). The kind is
// metadata for the editor; the nav only needs href/label/icon to render.
export const NAV_DEST_KINDS = ["builtin", "view", "type", "dashboard"] as const;
export type NavDestKind = (typeof NAV_DEST_KINDS)[number];

export type NavBadge = "inbox";

export type NavDestination = {
  kind: NavDestKind;
  href: string;
  label: string;
  icon: string;
  badge?: NavBadge; // optional count badge; only the inbox count for now
};

export type NavSlotConfig =
  | ({ type: "destination" } & NavDestination)
  | {
      type: "tools";
      label: string;
      icon: string;
      children: NavDestination[]; // up to MAX_TOOLS_CHILDREN; no nesting
    };

export type UserSettings = {
  highlightColor: string; // solid hex (a HIGHLIGHT_COLORS value, or a gradient's representative accent)
  // When set, an accent gradient (a HIGHLIGHT_GRADIENTS value) layered over fills;
  // null = a plain solid accent. highlightColor still holds the representative solid.
  highlightGradient: string | null;
  trashRetentionDays: number; // 1..365
  navPosition: NavPosition;
  railSize: RailSize;
  navDensity: NavDensity;
  railAnchor: RailAnchor;
  // The configurable middle nav slots (Home/New/More are added at render time).
  navSlots: NavSlotConfig[];
  // Mobile override: null mirrors the desktop slots; an array is a distinct
  // mobile list (recommended tighter, see RECOMMENDED_MOBILE_NAV_SLOTS).
  mobileNavSlots: NavSlotConfig[] | null;
  // How this owner signs shared content (the Changelog notes "Sign" stamp).
  // Empty falls back to the email's local part (see effectiveDisplayName).
  displayName: string;
  // Optional: a custom dashboard assigned as the Home (/) and/or Today surface.
  // null = render the fixed built-in layout (the default). A deleted/unowned id
  // parses back to null, so a removed dashboard silently falls back.
  homeDashboardId: string | null;
  todayDashboardId: string | null;
  // The unguessable token in the owner's published ICS task-feed URL (T4,
  // ADR-079). null = no feed published yet; generated/rotated from User
  // Settings. The feed route resolves the owner by this token (no Clerk),
  // same posture as a share link.
  icsToken: string | null;
};

// The starting middle slots: Inbox (with its count badge), Tasks, Search. The
// developer/admin destinations (Views, Items) that used to live in the nav are
// intentionally not here — they belong in Build, not daily nav.
export const DEFAULT_NAV_SLOTS: NavSlotConfig[] = [
  { type: "destination", kind: "builtin", href: "/inbox", label: "Inbox", icon: "inbox", badge: "inbox" },
  { type: "destination", kind: "builtin", href: "/tasks", label: "Tasks", icon: "tasks" },
  { type: "destination", kind: "builtin", href: "/search", label: "Search", icon: "search" },
];

export const DEFAULT_SETTINGS: UserSettings = {
  highlightColor: "#2563eb",
  highlightGradient: null,
  trashRetentionDays: 30,
  navPosition: "bottom",
  railSize: "fat",
  navDensity: "spread",
  railAnchor: "top",
  navSlots: DEFAULT_NAV_SLOTS,
  mobileNavSlots: null,
  displayName: "",
  homeDashboardId: null,
  todayDashboardId: null,
  icsToken: null,
};

const SETTINGS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate one destination, returning null if it's unusable. An unknown icon
// falls back rather than failing; the locked Home route ("/") is stripped so it
// can never be duplicated into the middle zone. badge keeps only "inbox".
function parseNavDestination(raw: unknown): NavDestination | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const href = typeof r.href === "string" ? r.href.trim() : "";
  if (!href || href === "/") return null; // empty or the locked Home slot
  const label = typeof r.label === "string" ? r.label.trim().slice(0, 40) : "";
  if (!label) return null;
  const kind = (NAV_DEST_KINDS as readonly string[]).includes(r.kind as string)
    ? (r.kind as NavDestKind)
    : "builtin";
  const icon = isNavIcon(r.icon) ? r.icon : NAV_ICON_FALLBACK;
  const dest: NavDestination = { kind, href, label, icon };
  if (r.badge === "inbox") dest.badge = "inbox";
  return dest;
}

// Validate one middle slot. A `tools` group flattens its children to plain
// destinations (so a nested group can't sneak in) and caps the count; an empty
// group is dropped. Returns null for anything unusable.
function parseNavSlot(raw: unknown): NavSlotConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "tools") {
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 40) : "";
    if (!label) return null;
    const icon = isNavIcon(r.icon) ? r.icon : "tools";
    const children = (Array.isArray(r.children) ? r.children : [])
      .map(parseNavDestination)
      .filter((c): c is NavDestination => c !== null)
      .slice(0, MAX_TOOLS_CHILDREN);
    if (children.length === 0) return null;
    return { type: "tools", label, icon, children };
  }
  // Anything else is treated as a destination (the common case).
  const dest = parseNavDestination(r);
  return dest ? { type: "destination", ...dest } : null;
}

// Parse a stored slot list, dropping malformed entries and capping the count.
// Returns the fallback when `raw` isn't an array at all (an empty array is a
// legitimate "no middle slots" choice and is preserved).
function parseNavSlots(raw: unknown, max: number, fallback: NavSlotConfig[]): NavSlotConfig[] {
  if (!Array.isArray(raw)) return fallback;
  return raw
    .map(parseNavSlot)
    .filter((s): s is NavSlotConfig => s !== null)
    .slice(0, max);
}

export function parseSettings(raw: unknown): UserSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const highlightColor =
    typeof r.highlightColor === "string" && ALLOWED_ACCENTS.has(r.highlightColor)
      ? r.highlightColor
      : DEFAULT_SETTINGS.highlightColor;
  // Keep the gradient only if it's a known one (else fall back to a solid accent).
  const highlightGradient = HIGHLIGHT_GRADIENTS.some((g) => g.value === r.highlightGradient)
    ? (r.highlightGradient as string)
    : DEFAULT_SETTINGS.highlightGradient;
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
  const dashRef = (v: unknown) =>
    typeof v === "string" && SETTINGS_UUID_RE.test(v) ? v : null;
  const homeDashboardId = dashRef(r.homeDashboardId);
  const todayDashboardId = dashRef(r.todayDashboardId);
  // base64url token, bounded; anything else → no feed.
  const icsToken =
    typeof r.icsToken === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(r.icsToken)
      ? r.icsToken
      : null;
  const navSlots = parseNavSlots(r.navSlots, NAV_SLOTS_HARD_CAP, DEFAULT_NAV_SLOTS);
  // null (or absent) means mirror desktop; an array is a distinct mobile list.
  const mobileNavSlots =
    r.mobileNavSlots == null
      ? null
      : parseNavSlots(r.mobileNavSlots, NAV_SLOTS_HARD_CAP, []);
  return {
    highlightColor,
    highlightGradient,
    trashRetentionDays: days,
    navPosition,
    railSize,
    navDensity,
    railAnchor,
    navSlots,
    mobileNavSlots,
    displayName,
    homeDashboardId,
    todayDashboardId,
    icsToken,
  };
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
