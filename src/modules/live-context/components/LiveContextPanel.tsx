// The live-context tracker, mounted only while the live-context module is on for
// the signed-in owner (ADR-272 step 4). ItemCanvas reaches it through
// src/lib/module-panels.tsx (panel id "live-context"), never by importing this
// module. Renders nothing visible: the tracker only reports what is open.
import ActiveContextTracker from "@/modules/live-context/components/ActiveContextTracker";
import { moduleOnFor } from "@/lib/modules/enabled";
import { resolveOwner } from "@/lib/owner";

export default async function LiveContextPanel({ itemId, title = "" }: { itemId: string; title?: string }) {
  const owner = await resolveOwner();
  if (!owner || !(await moduleOnFor(owner.id, "live-context"))) return null;
  return <ActiveContextTracker itemId={itemId} title={title} />;
}
