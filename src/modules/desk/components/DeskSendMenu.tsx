// The shared "Send to Desk" menu (ADR-146, S3/S3b). Two actions, built once:
//   - Open in Desk   → adds the item as a tab in the focused panel (layout intact)
//   - Open beside    → seeds a two-panel layout (current left, target right),
//                      snapshotting the old layout to Recent first
// Both then navigate to /desk. Reused two ways:
//   - DeskSendItems: the two menu rows, embedded in the list RowMenu (S3).
//   - DeskSendContextMenu: one globally-mounted popover (like ActionToast) that
//     opens at the cursor when an inline mention/link is right-clicked (S3b).
//     It is the module's shell panel (module-panels.tsx `shellPanels`), mounted
//     by the root layout only while the Desk module is on, and it hears the
//     editor through core's lib/inline-ref-menu (ADR-272 step 4).
// Desktop-only: the Desk is a desktop surface, so these are absent on touch and
// below 640px. Off: the shell panel is not mounted, so neither the inline menu
// nor the row-menu items appear.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsDesktop } from "@/components/markdown-editor/useIsDesktop";
import { listenInlineRefMenu, type InlineRefMenuDetail } from "@/lib/inline-ref-menu";
import {
  deskSendAvailable,
  sendOpenBeside,
  sendOpenInDesk,
  type DeskHost,
} from "@/modules/desk/lib/send";
import { useDeskHost } from "./DeskHostContext";

// The Desk is desktop-only: available on a fine pointer at ≥640px. Pointer type
// effectively never changes at runtime, so a lazy read is enough.
function useDeskAvailable(): boolean {
  const isDesktop = useIsDesktop();
  const [finePointer] = useState(() =>
    typeof window === "undefined"
      ? true
      : !window.matchMedia("(pointer: coarse)").matches
  );
  return isDesktop && finePointer;
}

// Whether the shell panel below is mounted, i.e. the Desk module is on for this
// owner (the root layout mounts it only then). The row-menu items read it so a
// switched-off Desk offers no "Send to Desk" in a list's RowMenu either. Read
// when a menu opens, long after the shell's effect has run.
let shellMounted = false;

const itemClass =
  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-surface-2";

// The "Open beside" label names the surface it anchors to, so it's clear WHAT
// the item will open beside (ADR-147 D1). Falls back to the bare verb when there
// is no reusable host (opens the item alone).
function besideLabel(host: DeskHost | null): string {
  if (host?.kind === "view") return "▥ Open beside this view";
  if (host?.kind === "dashboard") return "▥ Open beside this dashboard";
  if (host?.kind === "item") return "▥ Open beside this item";
  return "▥ Open beside";
}

export function DeskSendItems({
  itemId,
  currentItemId,
  onDone,
}: {
  itemId: string;
  // The inline-reference path (a mention/link inside an item you're reading)
  // passes the item you're reading explicitly; it wins over any page host.
  currentItemId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const available = useDeskAvailable();
  const pageHost = useDeskHost();
  if (!available || !shellMounted) return null;

  // Explicit reading-context item wins; otherwise the page's host surface.
  const host: DeskHost | null = currentItemId
    ? { kind: "item", itemId: currentItemId }
    : pageHost;

  const openInDesk = () => {
    sendOpenInDesk(itemId);
    onDone?.();
    router.push("/desk");
  };
  const openBeside = () => {
    sendOpenBeside(itemId, host);
    onDone?.();
    router.push("/desk");
  };

  return (
    <>
      <button type="button" role="menuitem" className={itemClass} onClick={openInDesk}>
        ▤ Send to Desk
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={openBeside}>
        {besideLabel(host)}
      </button>
    </>
  );
}

// One instance mounted in the root layout while the Desk module is on. Opens at
// the cursor when an inline reference is right-clicked; renders the same two
// actions.
export default function DeskSendContextMenu() {
  const [detail, setDetail] = useState<InlineRefMenuDetail | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    shellMounted = true;
    const unlisten = listenInlineRefMenu({
      available: deskSendAvailable,
      open: (d) => {
        if (d.itemId) setDetail(d);
      },
    });
    return () => {
      shellMounted = false;
      unlisten();
    };
  }, []);

  useEffect(() => {
    if (!detail) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setDetail(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", () => setDetail(null), true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [detail]);

  if (!detail) return null;
  // Clamp near a right/bottom edge (the menu is ~11rem wide, ~5rem tall).
  const x = Math.max(8, Math.min(detail.x, window.innerWidth - 190));
  const y = Math.max(8, Math.min(detail.y, window.innerHeight - 96));

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[80] min-w-[11rem] rounded-card border border-line-strong bg-surface-3 p-1 shadow-2xl shadow-black/50"
      style={{ left: x, top: y }}
    >
      <DeskSendItems
        itemId={detail.itemId}
        currentItemId={detail.currentItemId}
        onDone={() => setDetail(null)}
      />
    </div>
  );
}
