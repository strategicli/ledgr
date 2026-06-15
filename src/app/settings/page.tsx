// User Settings (v5). Per-owner UI preferences — highlight color, Trash
// retention, nav position. The one deliberate both-places surface (ADR-063):
// reached from the Work kebab *and* listed under the Build sidebar's MAINTAIN
// group, so personal/cosmetic settings don't require entering Build. The label
// stays "User Settings" everywhere (never bare "Settings").
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import SettingsForm from "@/components/settings/SettingsForm";
import BackButton from "@/components/ui/BackButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  const settings = await getSettings(owner.id);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">User Settings</h1>
          <BackButton />
        </div>
        <SettingsForm initial={settings} />
      </div>
    </main>
  );
}
