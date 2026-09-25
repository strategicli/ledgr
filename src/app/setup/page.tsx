import Link from "next/link";
import SetupOwnerForm from "@/components/auth/SetupOwnerForm";
import { builtinOnState } from "@/lib/auth/builtin-state";
import { isClerkConfigured, isDeployedEnv } from "@/lib/auth/keyless";
import { chooseFromProcessEnv } from "@/lib/auth/local";
import { oauthConfigured } from "@/lib/auth/oauth";
import { resetAvailableHere } from "@/lib/auth/signin-actions";
import { gatherHealth } from "@/lib/health";
import { installHasOwner } from "@/lib/instance-owner";
import { resolveOwnerState } from "@/lib/owner";
import { setupChecklist, setupView, type SetupItem } from "@/lib/setup-checklist";

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

  return (
    <Shell>
      <p className="text-sm text-ink-muted">
        {todo === 0
          ? "Everything Ledgr needs is in place."
          : `${todo} ${todo === 1 ? "thing needs" : "things need"} attention. Each one says why it matters and what to do.`}
      </p>
      {canCreateOwner && (
        <section className="mt-6 rounded-card border border-line bg-surface-1 p-5">
          <h2 className="ui-section-label text-ink">Create the owner</h2>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            You are at the computer running Ledgr, so you can make yourself its owner. This works only here: nobody on
            your network or the internet can do it.
          </p>
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
