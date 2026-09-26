import Link from "next/link";
import SetupOwnerForm from "@/components/auth/SetupOwnerForm";
import PairingCodeForm from "@/components/auth/PairingCodeForm";
import { cloudFacts } from "@/lib/sync/pairing-cloud";
import { WINDOW_CLOSED } from "@/lib/sync/pairing";
import { builtinOnState } from "@/lib/auth/builtin-state";
import { isClerkConfigured, isDeployedEnv } from "@/lib/auth/keyless";
import { chooseFromProcessEnv } from "@/lib/auth/local";
import { oauthConfigured } from "@/lib/auth/oauth";
import { resetAvailableHere } from "@/lib/auth/signin-actions";
import { gatherHealth } from "@/lib/health";
import { installHasOwner } from "@/lib/instance-owner";
import { resolveOwnerState } from "@/lib/owner";
import { setupChecklist, setupView, type SetupItem } from "@/lib/setup-checklist";
import ConnectTailscale from "@/components/setup/ConnectTailscale";
import RestoreFromBackup from "@/components/setup/RestoreFromBackup";
import { localDataDir, ownerItemCount, readRestoreResult } from "@/lib/first-run";
import { ModuleSettingsPanel } from "@/lib/module-panels";
import { moduleAvailable } from "@/lib/modules";
import { moduleIsOn } from "@/lib/modules/gate";

export const dynamic = "force-dynamic";

// /setup (ADR-275): is this Ledgr ready, and if not, what exactly to do. Public,
// because the person who needs it most often can't sign in yet. Once the copy
// has an owner, a visitor who isn't that owner sees only "set up, sign in":
// the checklist describes how this copy is configured. It never shows a secret
// value, only whether one is set (setupChecklist's input has no values at all).
export default async function SetupPage() {
  const hasOwner = await installHasOwner().catch(() => null);
  const state = await resolveOwnerState().catch(() => ({ kind: "signed-out" as const }));
  const view = setupView({ hasOwner, viewerIsOwner: state.kind === "owner" });
  // A cloud copy being paired with a hub (ADR-277). Only on a copy with no
  // supervisor: a machine you can sit at makes its owner the way below.
  const supervised = !!process.env.LEDGR_SUPERVISOR_DIR && !process.env.VERCEL_ENV;
  const pair = supervised ? null : await cloudFacts().catch(() => null);
  const pairing = pair?.state?.status === "paired" || pair?.state?.status === "filling";
  // A restore from the first-run page (ADR-282) reports back here for an hour.
  const dataDir = localDataDir();
  const atMachine = await resetAvailableHere();
  const restored = dataDir ? readRestoreResult(dataDir) : null;
  const restoreNotice = restored && <RestoreNotice ok={restored.ok} detail={atMachine ? restored.detail : null} />;

  if (view === "set-up" && pairing) {
    return (
      <Shell>
        <p className="text-sm text-ink-muted">
          Your main Ledgr is copying everything here. Keep its Network page open until it says it is done, then sign
          in here with the same password.
        </p>
      </Shell>
    );
  }

  if (view === "set-up") {
    // The one exception is the fact the front gate's refusal already states in
    // public: a deployed copy with no way to sign in at all.
    const noSignIn = isDeployedEnv() && !isClerkConfigured() && (await builtinOnState()) !== true;
    return (
      <Shell>
        {noSignIn ? (
          <p className="text-sm text-ink-muted">
            This Ledgr has an owner, but sign-in isn&rsquo;t set up on this copy, so it refuses every page. Its owner
            needs to add Clerk&rsquo;s two keys (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY) in the host&rsquo;s
            environment settings and redeploy. See runbook §1.
          </p>
        ) : (
          <>
            {restoreNotice}
            <p className="text-sm text-ink-muted">This Ledgr is set up.</p>
            <Link href="/sign-in" className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline">
              Sign in
            </Link>
          </>
        )}
      </Shell>
    );
  }

  const health = await gatherHealth();
  const c = health.checks;
  const builtinOn = (await builtinOnState()) === true;
  let items = setupChecklist({
    databaseOk: c.database.ok,
    schema: { state: c.schema.state, pending: c.schema.pending.length },
    hasOwner,
    clerkConfigured: isClerkConfigured(),
    builtinOn,
    machineOnly: chooseFromProcessEnv() === "local" && !builtinOn,
    deployed: isDeployedEnv(),
    supervised: !!process.env.LEDGR_SUPERVISOR_DIR && !process.env.VERCEL_ENV,
    oauthSecret: oauthConfigured(),
    mcpToken: c.mcp.hasToken,
    mcpOwner: c.mcp.ownerResolves,
    graphFailing: c.graph.configured && !c.graph.ok,
    githubFailing: c.github.configured && !c.github.ok,
  });
  // Owner unknown (the users table couldn't be read): only what /health already says.
  if (view === "database-only") items = items.filter((i) => i.id === "database" || i.id === "schema");

  const canCreateOwner = hasOwner === false && (await resetAvailableHere());
  const todo = items.filter((i) => i.status === "todo").length;
  // The two optional next steps (ADR-282): only for the owner, at the computer
  // running a local copy, while that copy is still empty. An install anyone
  // already uses never sees them.
  const fresh =
    state.kind === "owner" && !!dataDir && atMachine && (await ownerItemCount(state.owner.id).catch(() => 1)) === 0;

  return (
    <Shell>
      {restoreNotice}
      {fresh && state.kind === "owner" && <NextSteps ownerId={state.owner.id} />}
      <p className="text-sm text-ink-muted">
        {todo === 0
          ? "Everything Ledgr needs is in place."
          : `${todo} ${todo === 1 ? "thing needs" : "things need"} attention. Each one says why it matters and what to do.`}
      </p>
      {pair && hasOwner === false && (
        <section className="mt-6 rounded-card border border-line bg-surface-1 p-5">
          <h2 className="ui-section-label text-ink">Pair with your main Ledgr</h2>
          {pairing ? (
            <p className="mt-1 text-sm text-ink-muted">
              Paired. Your main Ledgr is copying everything here; keep its Network page open until it says it is done.
            </p>
          ) : pair.windowOpen ? (
            <>
              <p className="mt-1 mb-4 text-sm text-ink-muted">
                On the computer that runs your main copy of Ledgr, open Build, then Network, then Keep a copy in the
                cloud, and paste this copy&rsquo;s address. It shows a code. Type that code here and it fills this
                copy with everything, your password included.
              </p>
              <PairingCodeForm />
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">{WINDOW_CLOSED}</p>
          )}
        </section>
      )}
      {canCreateOwner && (
        <section className="mt-6 rounded-card border border-line bg-surface-1 p-5">
          <h2 className="ui-section-label text-ink">Create the owner</h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            You are at the computer running Ledgr, so you can make yourself its owner. This works only here: nobody on
            your network or the internet can do it.
          </p>
          <FirewallNote />
          <SetupOwnerForm />
        </section>
      )}
      <ul className="mt-6 space-y-3">
        {items.map((i) => (
          <Row key={i.id} item={i} />
        ))}
      </ul>
    </Shell>
  );
}

// Setting a password makes Ledgr listen beyond this computer (ADR-275), which
// is what makes the operating system's firewall ask. Said before the owner
// meets it. Linux shows no such prompt, so it says nothing there.
function FirewallNote() {
  const line =
    process.platform === "win32" ? (
      <>
        When you finish, Windows may show a &ldquo;Windows Defender Firewall&rdquo; box about Node.js. Click{" "}
        <strong className="text-ink">Allow</strong> (private networks is enough). If you click Cancel, Ledgr still works
        on this computer, but your phone and other computers on your network can&rsquo;t reach it until you allow it in
        Windows Security, under Firewall &amp; network protection, &ldquo;Allow an app through firewall&rdquo;.
      </>
    ) : process.platform === "darwin" ? (
      <>
        If your Mac&rsquo;s firewall is turned on, macOS may ask whether &ldquo;node&rdquo; can accept incoming network
        connections when you finish. Click <strong className="text-ink">Allow</strong>. If you click Deny, Ledgr still
        works on this Mac, but your phone and other computers on your network can&rsquo;t reach it until you allow it in
        System Settings, under Network, Firewall.
      </>
    ) : null;
  return line ? <p className="mb-4 ui-meta text-ink-subtle">{line}</p> : null;
}

function RestoreNotice({ ok, detail }: { ok: boolean; detail: string | null }) {
  return (
    <p
      role="status"
      className={`mb-6 rounded-card border p-4 text-sm text-ink ${ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}
    >
      {ok
        ? "Your backup is restored. Sign in with the password your old copy used. If it didn't use one, choose Reset Ledgr sign-in password on this computer (the Start menu or tray icon on Windows, Applications › Ledgr on a Mac, Ledgr's right-click menu on Linux)."
        : `The restore didn't work${detail ? `: ${detail}` : ""}. Nothing was loaded from the backup. The details are in supervisor.log in Ledgr's data folder.`}
    </p>
  );
}

// The two optional next steps on a brand-new local copy (ADR-282). Neither is
// required; both say how to skip. Tailscale renders the module's own panel once
// the module is on (module-panels.tsx, so core never imports the module).
async function NextSteps({ ownerId }: { ownerId: string }) {
  const tailscale = moduleAvailable("tailscale");
  const tailscaleOn = tailscale && (await moduleIsOn(ownerId, "tailscale"));
  return (
    <section className="mb-6 rounded-card border border-line-strong bg-surface-1 p-5">
      <h2 className="ui-section-label text-ink">Two optional next steps</h2>
      <p className="mt-1 text-sm text-ink-muted">You are set up. Both of these can wait, and you can skip them.</p>

      <div className="mt-5">
        <h3 className="text-sm font-medium text-ink">Restore from a backup</h3>
        <p className="mt-1 mb-3 text-sm text-ink-muted">
          Moving over from another copy of Ledgr? Bring everything across in one step. Choose a{" "}
          <span className="group relative cursor-help">
            <span className="underline decoration-dotted decoration-neutral-600 underline-offset-2">backup file</span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-72 rounded-card border border-neutral-700 bg-neutral-900 p-2 text-xs normal-case text-ink-muted opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
            >
              Either the weekly backup (ledgr-YYYY-MM-DD.dump, in OneDrive under Ledgr, Backups) or a restore point
              copied from the other computer (a .dump file in its data folder, under snapshots).
            </span>
          </span>{" "}
          ending in .dump. It replaces this copy, including the owner you just made, so afterwards you sign in with the
          old copy&rsquo;s password. Attached files (images, PDFs) are not inside a backup and may show as missing.{" "}
          <span className="text-ink">Starting fresh? Skip this.</span>
        </p>
        <RestoreFromBackup itemCount={0} />
      </div>

      {tailscale && (
        <div className="mt-6 border-t border-line pt-5">
          <h3 className="text-sm font-medium text-ink">Connect with Tailscale</h3>
          {tailscaleOn ? (
            <div className="mt-2">
              <ModuleSettingsPanel id="tailscale" ownerId={ownerId} />
            </div>
          ) : (
            <>
              <p className="mt-1 mb-3 text-sm text-ink-muted">
                Reach this Ledgr from your phone and your other devices, wherever you are, through a free private
                network only your devices can join. Not now? Skip this; it is also under Build, Modules.
              </p>
              <ConnectTailscale />
            </>
          )}
        </div>
      )}

      <Link href="/" className="mt-6 inline-block text-sm text-[var(--accent)] hover:underline">
        Skip for now and open Ledgr
      </Link>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="ui-title text-ink">Ledgr setup</h1>
      <div className="mt-2">{children}</div>
    </main>
  );
}

const MARK: Record<SetupItem["status"], { glyph: string; cls: string; label: string }> = {
  done: { glyph: "✓", cls: "text-emerald-400", label: "Done" },
  todo: { glyph: "!", cls: "text-amber-400", label: "Needs attention" },
  tip: { glyph: "i", cls: "text-sky-400", label: "Good to know" },
};

function Row({ item }: { item: SetupItem }) {
  const m = MARK[item.status];
  return (
    <li className="flex gap-3 rounded-card border border-line bg-surface-1 p-4">
      <span aria-label={m.label} className={`mt-0.5 w-4 shrink-0 text-center font-bold ${m.cls}`}>
        {m.glyph}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{item.title}</p>
        {item.why && <p className="mt-1 text-sm text-ink-muted">{item.why}</p>}
        {item.fix && (
          <p className="mt-1 text-sm text-ink-subtle">
            <span className="font-medium text-ink-muted">What to do: </span>
            {item.fix}
          </p>
        )}
        {item.href && (
          <Link href={item.href.path} className="mt-1 inline-block text-sm text-[var(--accent)] hover:underline">
            {item.href.label}
          </Link>
        )}
      </div>
    </li>
  );
}
