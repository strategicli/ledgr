// The Share link control, shown only while the sharing module is on for the
// signed-in owner (ADR-272 step 4). Core canvases reach it through
// src/lib/module-panels.tsx, never by importing this module.
import ShareLink from "@/modules/sharing/components/ShareLink";
import { moduleOnFor } from "@/lib/modules/enabled";
import { resolveOwner } from "@/lib/owner";

export default async function SharePanel({ itemId, bare = false }: { itemId: string; bare?: boolean }) {
  const owner = await resolveOwner();
  if (!owner || !(await moduleOnFor(owner.id, "sharing"))) return null;
  return <ShareLink itemId={itemId} bare={bare} />;
}
