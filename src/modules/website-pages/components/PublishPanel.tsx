// The Publish control, shown only while the Website Pages module is on for the
// signed-in owner. Core canvases reach it through src/lib/module-panels.tsx.
import PublishControl from "@/modules/website-pages/components/PublishControl";
import { moduleOnFor } from "@/lib/modules/enabled";
import { resolveOwner } from "@/lib/owner";

export default async function PublishPanel({ itemId }: { itemId: string }) {
  const owner = await resolveOwner();
  if (!owner || !(await moduleOnFor(owner.id, "website-pages"))) return null;
  return <PublishControl itemId={itemId} />;
}
