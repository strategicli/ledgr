// Full-page item view: the expanded form of the canvas (PRD §4.13). Direct
// loads, refreshes, and the modal's Expand land here; in-app clicks are
// intercepted into the center modal (src/app/@modal).
import type { Metadata } from "next";
import ItemCanvas from "@/components/canvas/ItemCanvas";
import { getItem } from "@/lib/items";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

// Drive the browser tab / history / bookmark title from the item's own title
// instead of the ID (root layout appends " · Ledgr"). Best-effort: signed-out,
// not-found, or any error falls back to the plain "Ledgr" default.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const owner = await resolveOwner();
    if (!owner) return {};
    const item = await getItem(owner.id, id);
    const title = item.title?.trim();
    return title ? { title } : { title: "Untitled" };
  } catch {
    return {};
  }
}

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ arrange?: string }>;
}) {
  const { id } = await params;
  // Per-type layout arrange mode (ADR-069): a hard nav to ?arrange=1 lands here
  // (the full page, escaping the intercept modal) and renders the grid editor.
  const { arrange } = await searchParams;
  return (
    <main className="min-h-screen">
      <ItemCanvas id={id} variant="page" arrange={arrange === "1"} />
    </main>
  );
}
