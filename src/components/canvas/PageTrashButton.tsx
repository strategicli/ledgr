// Move-to-Trash action for the full-page item canvas's top-left chrome slot.
// Mirrors the modal's Trash button (Modal.tsx) so the page and the intercepted
// modal read the same — that slot used to hold a "← All items" link to the
// negligibly-useful /items sweep, which didn't earn the prime real estate.
//
// It lives in a client wrapper because ItemCanvas is a server component and
// can't hand ConfirmButton an onConfirm function across the boundary (the modal
// can because it's already a client component). On success it leaves the
// now-trashed page: to the parent item when there is one, else home.
"use client";

import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import ActionGlyph from "@/components/canvas/action-icons";

export default function PageTrashButton({
  itemId,
  parentId,
}: {
  itemId: string;
  parentId: string | null;
}) {
  const router = useRouter();
  return (
    <ConfirmButton
      title="Move to Trash?"
      description="This item moves to Trash and can be recovered for 30 days."
      confirmLabel="Trash"
      trigger={<ActionGlyph icon="trash" />}
      triggerLabel="Move to Trash"
      triggerClassName="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
      align="left"
      onConfirm={async () => {
        const res = await fetch(`/api/items/${itemId}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        router.push(parentId ? `/items/${parentId}` : "/");
        router.refresh();
      }}
    />
  );
}
