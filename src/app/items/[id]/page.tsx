// Full-page item view: the expanded form of the canvas (PRD §4.13). Direct
// loads, refreshes, and the modal's Expand land here; in-app clicks are
// intercepted into the center modal (src/app/@modal).
import ItemCanvas from "@/components/canvas/ItemCanvas";

export const dynamic = "force-dynamic";

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
