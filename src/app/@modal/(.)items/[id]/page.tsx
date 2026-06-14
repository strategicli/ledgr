// Intercepted /items/[id]: a client-side navigation to an item opens the
// canvas in a center modal over whatever list launched it (PRD §4.13,
// Notion-default). The URL is the real item URL, so refresh or a shared
// link lands on the full page in src/app/items/[id].
import ItemCanvas from "@/components/canvas/ItemCanvas";
import Modal from "@/components/canvas/Modal";
import { getItem } from "@/lib/items";
import { canvasIdForType } from "@/lib/modules";
import { resolveOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

export default async function ItemModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Widen the modal for canvases that need it (a song's two-column chart).
  // Best-effort: any failure just yields the default-width modal, and
  // ItemCanvas surfaces the real not-found/auth handling.
  let wide = false;
  try {
    const owner = await resolveOwner();
    if (owner) {
      const item = await getItem(owner.id, id);
      wide = canvasIdForType(item.type, owner.id) === "chord";
    }
  } catch {
    // ignore — render the default modal width
  }
  return (
    <Modal itemId={id} wide={wide}>
      <ItemCanvas id={id} variant="modal" />
    </Modal>
  );
}
