// Full-page item view: the expanded form of the canvas (PRD §4.13). Direct
// loads, refreshes, and the modal's Expand land here; in-app clicks are
// intercepted into the center modal (src/app/@modal).
import ItemCanvas from "@/components/canvas/ItemCanvas";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="min-h-screen">
      <ItemCanvas id={id} variant="page" />
    </main>
  );
}
