// Navigation slots (PRD §4.12): a small set of user-chosen destinations,
// not a fixed menu. Home (the dashboard) is always slot 1. Slot contents,
// order, and badges become Build-surface configuration later; this
// hardcoded table is that config's stand-in, the same seam pattern as
// canvas-fields.ts.
export type BadgeSource = "inbox";

export type NavSlot = {
  key: string;
  label: string;
  href: string;
  // Which count the slot surfaces at a glance (PRD §4.11); resolved
  // server-side by the Nav wrapper.
  badge?: BadgeSource;
};

export const NAV_SLOTS: NavSlot[] = [
  { key: "home", label: "Home", href: "/" }, // locked slot 1
  { key: "inbox", label: "Inbox", href: "/inbox", badge: "inbox" },
  { key: "items", label: "Items", href: "/items" },
];
