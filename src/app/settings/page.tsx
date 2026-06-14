// User settings (v5). Per-owner UI preferences — highlight color, Trash
// retention, nav position. Reached from the nav kebab.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import SettingsForm from "@/components/settings/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  const settings = await getSettings(owner.id);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Settings</h1>
          <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Back
          </Link>
        </div>
        <SettingsForm initial={settings} />
      </div>
    </main>
  );
}
