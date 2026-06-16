// The `song` type's canvas (Song module, S3). A server shell that mounts the
// client editor/preview (ChordCanvasClient owns the ChordChart + autosave +
// the Edit ⇄ Preview toggle), then the standard bottom panels reused from the
// default canvas — backlinks, Save Offline, Share, and any custom properties
// (e.g. the workflow Stage). The chord chart itself replaces the markdown
// editor; everything below it is shared.
import ChordCanvasClient from "@/components/canvas/ChordCanvasClient";
import CustomProperties from "@/components/build/CustomProperties";
import RelatedPanel from "@/components/relations/RelatedPanel";
import RelationProperties from "@/components/relations/RelationProperties";
import SaveOffline from "@/components/canvas/SaveOffline";
import ShareLink from "@/components/canvas/ShareLink";
import { getType } from "@/lib/types";
import type { CanvasProps } from "@/lib/modules";

export default async function ChordCanvas({ item, ownerId }: CanvasProps) {
  const typeDef = await getType(item.type).catch(() => null);
  const propertySchema = typeDef?.propertySchema ?? [];

  return (
    <>
      <ChordCanvasClient itemId={item.id} initialTitle={item.title} initialBody={item.body} />
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
      <SaveOffline itemId={item.id} />
      <ShareLink itemId={item.id} />
    </>
  );
}
