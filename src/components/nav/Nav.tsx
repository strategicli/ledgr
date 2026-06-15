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
import { resolveOwner } from "@/lib/owner";
import {
  getSettings,
  type NavBadge,
  type NavSlotConfig,
} from "@/lib/settings";
import { compareTypeKeys } from "@/lib/type-order";

export default async function Nav() {
  const owner = await resolveOwner();
  if (!owner) return null;

  // Quick-capture types are data-driven and opt-in (type-and-kind-ux §2): only
  // types flagged show_in_quick_capture appear, so a custom type can be
  // captured into and a "data only" one can stay out of the dropdown.
  const [inboxCount, typeRows, settings] = await Promise.all([
    countInbox(owner.id),
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
  ]);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));

  const counts: Record<NavBadge, number | null> = { inbox: inboxCount };
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
      // A group surfaces the inbox count if any of its children carries it
      // (one badge source for now, kept simple — spec §Nav.tsx).
      const groupCount = slot.children.some((c) => c.badge === "inbox")
        ? counts.inbox
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
      typeOptions={typeRows}
      navPosition={settings.navPosition}
      railSize={settings.railSize}
      navDensity={settings.navDensity}
      railAnchor={settings.railAnchor}
    />
  );
}
