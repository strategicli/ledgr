// Server wrapper for the nav shell: resolves the signed-in owner (no nav on
// the signed-out hero or /sign-in), fills slot badge counts (PRD §4.11), and
// gathers the type options the quick-capture modal offers, before handing
// the static slot list to the client chrome.
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { types } from "@/db/schema";
import NavShell, { type ShellSlot } from "@/components/nav/NavShell";
import { countInbox } from "@/lib/items";
import { NAV_SLOTS, type BadgeSource } from "@/lib/nav";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
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
      .where(eq(types.showInQuickCapture, true)),
    getSettings(owner.id),
  ]);
  typeRows.sort((a, b) => compareTypeKeys(a.key, b.key));
  const counts: Record<BadgeSource, number | null> = {
    inbox: inboxCount,
  };

  const slots: ShellSlot[] = NAV_SLOTS.map((s) => ({
    key: s.key,
    label: s.label,
    href: s.href,
    count: s.badge ? counts[s.badge] : null,
  }));

  return (
    <NavShell
      slots={slots}
      typeOptions={typeRows}
      navPosition={settings.navPosition}
      railSize={settings.railSize}
      navDensity={settings.navDensity}
      railAnchor={settings.railAnchor}
    />
  );
}
