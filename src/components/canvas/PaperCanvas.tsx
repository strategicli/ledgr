// The `paper` type's canvas (Papers module, P3). A server shell that mounts the
// client workspace (PaperCanvasClient owns the Quote Bank · Outline · Draft tabs,
// citation insertion, autosave, and the MSM .docx export), then the standard
// bottom panels reused from the default canvas — backlinks, Save Offline, Share.
//
// Note: unlike MarkdownCanvas, this does NOT render CustomProperties. A paper's
// properties (title-page meta + the outline/quote-bank scaffold) are written by
// PaperCanvasClient as the single writer, so a second whole-object properties
// writer can't clobber it. The title-page meta form lives inside the Draft tab.
import PaperCanvasClient from "@/components/paper-editor/PaperCanvasClient";
import RelatedPanel from "@/components/relations/RelatedPanel";
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import type { CanvasProps } from "@/lib/modules";

export default async function PaperCanvas({ item, ownerId }: CanvasProps) {
  return (
    <>
      <PaperCanvasClient
        itemId={item.id}
        initialTitle={item.title}
        initialBody={item.body}
        initialProperties={item.properties}
      />
      <RelatedPanel ownerId={ownerId} itemId={item.id} itemType={item.type} />
      <SaveOffline itemId={item.id} />
      <ShareLink itemId={item.id} />
    </>
  );
}
