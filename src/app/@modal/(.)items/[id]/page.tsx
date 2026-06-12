// Intercepted /items/[id]: a client-side navigation to an item opens the
// canvas in a center modal over whatever list launched it (PRD §4.13,
// Notion-default). The URL is the real item URL, so refresh or a shared
// link lands on the full page in src/app/items/[id].
import ItemCanvas from "@/components/canvas/ItemCanvas";
import Modal from "@/components/canvas/Modal";

export const dynamic = "force-dynamic";

export default async function ItemModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Modal itemId={id}>
      <ItemCanvas id={id} variant="modal" />
    </Modal>
  );
}
