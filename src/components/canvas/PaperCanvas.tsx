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
import CanvasSection from "@/components/canvas/CanvasSection";
import RelationProperties from "@/components/relations/RelationProperties";
import RelatedPanel from "@/components/relations/RelatedPanel";
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import { getType } from "@/lib/types";
import type { CanvasProps } from "@/lib/modules";

export default async function PaperCanvas({ item, ownerId }: CanvasProps) {
  const typeDef = await getType(item.type).catch(() => null);
  const propertySchema = typeDef?.propertySchema ?? [];
  const hasRelations = propertySchema.some((p) => p.kind === "relation");
  return (
    <>
      <PaperCanvasClient
        itemId={item.id}
        initialTitle={item.title}
        initialBody={item.body}
        initialProperties={item.properties}
        createdAt={
          item.createdAt instanceof Date
            ? item.createdAt.toISOString()
            : String(item.createdAt)
        }
      />
      {/* Relation fields (if the paper type declares any), under the standardized
          Properties header. Safe to render even though scalar CustomProperties is
          deliberately omitted: relations live in the `relations` table, not
          items.properties, so this can't clobber PaperCanvasClient's single-writer
          properties. Without it, the Linked-here de-dup would hide a relation field. */}
      {hasRelations && (
        <CanvasSection icon="properties" title="Properties">
          <RelationProperties
            ownerId={ownerId}
            itemId={item.id}
            typeKey={item.type}
            props={propertySchema}
            hideHeading
            bare
          />
        </CanvasSection>
      )}
      <RelatedPanel ownerId={ownerId} itemId={item.id} />
      <SaveOffline itemId={item.id} />
      <ShareLink itemId={item.id} />
    </>
  );
}
