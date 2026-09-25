// The Discover section, shown only while the relatedness module is on for the
// signed-in owner (ADR-272 step 4). Core canvases reach it through
// src/lib/module-panels.tsx, never by importing this module.
import DiscoverPanel from "@/modules/relatedness/components/DiscoverPanel";
import { moduleOnFor } from "@/lib/modules/enabled";
import { resolveOwner } from "@/lib/owner";

export default async function DiscoverSection({
  itemId,
  title = "",
  bare = false,
}: {
  itemId: string;
  title?: string;
  bare?: boolean;
}) {
  const owner = await resolveOwner();
  if (!owner || !(await moduleOnFor(owner.id, "relatedness"))) return null;
  return <DiscoverPanel itemId={itemId} anchorTitle={title} bare={bare} />;
}
