// The Desk (ADR-146): a desktop-only, multi-panel workspace. This server wrapper
// only gates auth (owner resolve); everything else — the layout tree, panels,
// persistence, the 640px fallback — lives in the client shell, since the Desk's
// arrangement is per-device app state (localStorage), never server or URL state.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import DeskClient from "@/components/desk/DeskClient";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Desk" };

export default async function DeskPage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  // Named workspaces are synced (settings jsonb); the live layout + Recent ring
  // are per-device and load client-side from localStorage.
  const settings = await getSettings(owner.id);
  return <DeskClient initialWorkspaces={settings.deskWorkspaces} />;
}
