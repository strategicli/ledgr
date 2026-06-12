// Server wrapper for the nav shell: resolves the signed-in owner (no nav on
// the signed-out hero or /sign-in) and fills slot badge counts (PRD §4.11)
// before handing the static slot list to the client chrome.
import NavShell, { type ShellSlot } from "@/components/nav/NavShell";
import { countInbox } from "@/lib/items";
import { NAV_SLOTS, type BadgeSource } from "@/lib/nav";
import { resolveOwner } from "@/lib/owner";

export default async function Nav() {
  const owner = await resolveOwner();
  if (!owner) return null;

  const counts: Record<BadgeSource, number | null> = {
    inbox: await countInbox(owner.id),
  };

  const slots: ShellSlot[] = NAV_SLOTS.map((s) => ({
    key: s.key,
    label: s.label,
    href: s.href,
    count: s.badge ? counts[s.badge] : null,
  }));

  return <NavShell slots={slots} />;
}
