// The `mindmap` type's canvas (Mindmap module). A server shell that mounts the
// client map (MindmapCanvasClient owns the tree, the layout render, in-place
// editing, and autosave), then the standard bottom panels reused from the default
// canvas — custom properties, relations, backlinks, Save Offline, and Share. The
// map replaces the markdown editor; everything below it is shared, exactly like
// ChordCanvas / PaperCanvas.
import MindmapCanvasClient from "@/components/canvas/MindmapCanvasClient";
import CustomProperties from "@/components/build/CustomProperties";
import RelatedPanel from "@/components/relations/RelatedPanel";
import RelationProperties from "@/components/relations/RelationProperties";
import ItemUtilitiesFooter from "@/components/canvas/ItemUtilitiesFooter";
import { bodyMarkdown } from "@/lib/body";
import { getType } from "@/lib/types";
import type { CanvasProps } from "@/lib/modules";

export default async function MindmapCanvas({ item, ownerId }: CanvasProps) {
  const typeDef = await getType(item.type).catch(() => null);
  const propertySchema = typeDef?.propertySchema ?? [];

  return (
    <>
      <MindmapCanvasClient itemId={item.id} initialTitle={item.title} initialBody={item.body} />
      {propertySchema.length > 0 && (
        <CustomProperties
          itemId={item.id}
          typeKey={item.type}
          schema={propertySchema}
          initial={(item.properties as Record<string, unknown>) ?? {}}
        />
      )}
      <RelationProperties
        ownerId={ownerId}
        itemId={item.id}
        typeKey={item.type}
        props={propertySchema}
      />
      <RelatedPanel ownerId={ownerId} itemId={item.id} />
      <ItemUtilitiesFooter itemId={item.id} currentText={bodyMarkdown(item.body)} />
    </>
  );
}
