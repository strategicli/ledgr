// Server wrapper for the nav shell: resolves the signed-in owner (no nav on
// the signed-out hero or /sign-in), reads the owner's configurable nav slots
// (ADR-056), fills any count badges (PRD §4.11), and gathers the type options
// the quick-capture modal offers, before handing render-ready slots to the
// client chrome.
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import NavShell, {
  type ShellDest,
  type ShellSlot,
} from "@/components/nav/NavShell";
import { countInbox } from "@/lib/items";
import { countUnread } from "@/lib/notifications";
import { NOTIFICATION_CENTER_ENABLED } from "@/lib/notifications-enabled";
import { resolveOwner } from "@/lib/owner";
import {
  getSettings,
  type NavBadge,
  type NavSlotConfig,
} from "@/lib/settings";
import { compareTypeKeys } from "@/lib/type-order";
import { listTypes } from "@/lib/types";

export default async function Nav() {
  const owner = await resolveOwner();
  if (!owner) return null;

  // Quick-capture types are data-driven and opt-in (type-and-kind-ux §2): only
  // types flagged show_in_quick_capture appear, so a custom type can be
  // captured into and a "data only" one can stay out of the dropdown.
  const [inboxCount, unreadCount, typeRows, settings, buildTypes] = await Promise.all([
    countInbox(owner.id),
    // Notification center paused (ADR-130): skip the unread query, badge stays 0.
    NOTIFICATION_CENTER_ENABLED ? countUnread(owner.id) : Promise.resolve(0),
    getDb()
      .select({ key: types.key, label: types.label })
      .from(types)
      .where(
        and(
          eq(types.showInQuickCapture, true),
          eq(types.hidden, false),
          isNull(types.deletedAt)
        )
      ),
    getSettings(owner.id),
    // The owner's live types (non-hidden, non-deleted) for the Build sidebar's
    // Types & Properties dropdown. Tiny instance-global table; cheap to read.
    listTypes(),
  ]);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));

  const counts: Record<NavBadge, number | null> = {
    inbox: inboxCount,
    notifications: unreadCount,
  };
  const badgeCount = (badge?: NavBadge) => (badge ? counts[badge] : null);

  const toDest = (d: {
    href: string;
    label: string;
    icon: string;
    badge?: NavBadge;
  }): ShellDest => ({
    label: d.label,
    href: d.href,
    icon: d.icon,
    count: badgeCount(d.badge),
  });

  const toShellSlot = (slot: NavSlotConfig): ShellSlot => {
    if (slot.type === "tools") {
      // A group surfaces the sum of its badge-carrying children's counts, so a
      // collapsed group still shows there's something waiting inside.
      const childCounts = slot.children
        .map((c) => badgeCount(c.badge))
        .filter((n): n is number => typeof n === "number");
      const groupCount = childCounts.length
        ? childCounts.reduce((a, b) => a + b, 0)
        : null;
      return {
        kind: "tools",
        label: slot.label,
        icon: slot.icon,
        count: groupCount,
        children: slot.children.map(toDest),
      };
    }
    return { kind: "destination", ...toDest(slot) };
  };

  const slots = settings.navSlots.map(toShellSlot);
  // null mobileNavSlots mirrors the desktop list.
  const mobileSlots = (settings.mobileNavSlots ?? settings.navSlots).map(
    toShellSlot
  );

  return (
    <NavShell
      slots={slots}
      mobileSlots={mobileSlots}
      unreadCount={unreadCount}
      typeOptions={typeRows}
      buildTypes={buildTypes.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
      aiMemoryEnabled={settings.aiMemoryEnabled}
      navPosition={settings.navPosition}
      railSize={settings.railSize}
      navDensity={settings.navDensity}
      railAnchor={settings.railAnchor}
    />
  );
}
