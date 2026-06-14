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

export type UserSettings = {
  highlightColor: string; // hex from HIGHLIGHT_COLORS
  trashRetentionDays: number; // 1..365
  navPosition: NavPosition;
};

export const DEFAULT_SETTINGS: UserSettings = {
  highlightColor: "#2563eb",
  trashRetentionDays: 30,
  navPosition: "bottom",
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
  return { highlightColor, trashRetentionDays: days, navPosition };
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
