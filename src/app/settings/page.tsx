// User Settings (v5). Per-owner UI preferences — highlight color, Trash
// retention, nav position. The one deliberate both-places surface (ADR-063):
// reached from the Work kebab *and* listed under the Build sidebar's MAINTAIN
// group, so personal/cosmetic settings don't require entering Build. The label
// stays "User Settings" everywhere (never bare "Settings").
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { API_SCOPES, listCredentials } from "@/lib/auth/credentials";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { DEFAULT_TIMEZONE } from "@/lib/today";
import SettingsForm from "@/components/settings/SettingsForm";
import ApiCredentials from "@/components/settings/ApiCredentials";
import IcsFeed from "@/components/settings/IcsFeed";
import BackButton from "@/components/ui/BackButton";
import AgentSettings from "@/modules/agent/components/AgentSettings";
import { agentAvailable } from "@/modules/agent/lib/gate";
import { moduleOn } from "@/lib/modules/enabled";
import SigninSettings, { type SigninSettingsProps } from "@/components/settings/SigninSettings";
import { clerkLinkedHere, currentBuiltinSession, listSessions, signinStatus } from "@/lib/auth/builtin";
import { builtinAllowedHere, effectiveMethod, readInstall } from "@/lib/auth/builtin-state";
import { isClerkConfigured } from "@/lib/auth/keyless";
import { chooseFromProcessEnv } from "@/lib/auth/local";

export const dynamic = "force-dynamic";

// The Sign-in section's facts (ADR-274), all about THIS copy of Ledgr.
async function signinProps(ownerId: string, host: string, recovered: boolean): Promise<SigninSettingsProps> {
  const [install, status, sessions, current] = await Promise.all([
    readInstall(),
    signinStatus(ownerId),
    listSessions(ownerId),
    currentBuiltinSession(),
  ]);
  const clerk = isClerkConfigured();
  return {
    method: effectiveMethod(install),
    defaultLabel: clerk ? "Clerk" : chooseFromProcessEnv() === "local" ? "No sign-in (this computer only)" : null,
    passwordSet: status.passwordSet,
    codesLeft: status.codesLeft,
    sessions,
    builtinSignedIn: !!current,
    clerkLinkedHere: await clerkLinkedHere(ownerId),
    overridden: !!process.env.LEDGR_SIGNIN_METHOD,
    where: host,
    recovered,
  };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  const settings = await getSettings(owner.id);
  const recovered = (await searchParams).recovered === "1";

  // Origin from the serving request so the clipper bookmarklet points at the
  // right host (prod, preview, or localhost) without an env var — same
  // derivation the AI & MCP page uses.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL ?? "");
  const credentials = await listCredentials(owner.id);
  const signin = builtinAllowedHere() ? await signinProps(owner.id, host, recovered) : null;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">User Settings</h1>
          <BackButton />
        </div>
        <SettingsForm
          initial={settings}
          serverDefaultTz={DEFAULT_TIMEZONE}
          notificationsOn={moduleOn(settings, "notification-center")}
          liveContextOn={moduleOn(settings, "live-context")}
        />
        {agentAvailable() && (
          <AgentSettings initial={settings.agent} on={moduleOn(settings, "agent")} />
        )}
        {signin && <SigninSettings {...signin} />}
        <IcsFeed initialToken={settings.icsToken} />
        <ApiCredentials
          initial={credentials}
          scopes={API_SCOPES}
          origin={origin}
        />
      </div>
    </main>
  );
}
