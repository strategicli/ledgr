"use client";
// First-run setup at the machine (ADR-275): your email and a password, then the
// recovery kit with one code typed back. Finishing switches this copy to
// password sign-in and signs this browser in. The one-time ticket arrives after
// "#" (from npm run local:setup-owner or the tray), exactly as on the reset page.
import { useEffect, useRef, useState } from "react";
import RecoveryKit from "@/components/auth/RecoveryKit";
import { createOwnerAtMachine, finishResetAtMachine } from "@/lib/auth/signin-actions";

const INPUT =
  "w-full rounded-card border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none";
const PRIMARY =
  "rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

export default function SetupOwnerForm() {
  const ticket = useRef("");
  const [hasTicket, setHasTicket] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [kit, setKit] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Keep the ticket in memory and drop it from the address bar. The link can
    // also land on this page while it is already open (only the "#" changes).
    const take = () => {
      const t = window.location.hash.slice(1);
      if (t) {
        ticket.current = t;
        window.history.replaceState(null, "", window.location.pathname);
      }
      setHasTicket(!!ticket.current);
    };
    take();
    window.addEventListener("hashchange", take);
    return () => window.removeEventListener("hashchange", take);
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await createOwnerAtMachine(ticket.current, email, pw, pw2);
      if (!res.ok) setError(res.error);
      else setKit(res.kit ?? null);
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish(code: string): Promise<string | null> {
    const res = await finishResetAtMachine(ticket.current, code);
    if (!res.ok) return res.error;
    window.location.assign("/");
    return null;
  }

  if (hasTicket === null) return null;
  if (!hasTicket) {
    return (
      <p className="text-sm text-ink-muted">
        To create the owner, open the Start menu on this computer and choose Reset Ledgr sign-in password, or
        right-click the Ledgr tray icon and choose Reset sign-in password. (In a copy built from source,{" "}
        <code className="font-mono text-ink">npm run local:setup-owner</code> does the same.) Each one reopens this
        page with a one-time link that works for 15 minutes.
      </p>
    );
  }
  if (kit) {
    return <RecoveryKit codes={kit} where={window.location.host} confirmLabel="Finish and sign in" onConfirm={finish} />;
  }
  return (
    <div className="space-y-3">
      <label htmlFor="setup-email" className="block ui-meta">
        Your email address
      </label>
      <input id="setup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
      <label htmlFor="setup-pw" className="block ui-meta">
        Choose a password (at least 8 characters)
      </label>
      <input id="setup-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={INPUT} />
      <label htmlFor="setup-pw2" className="block ui-meta">
        Type it again
      </label>
      <input id="setup-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={INPUT} />
      <button type="button" onClick={() => void save()} disabled={busy || !email || !pw} className={PRIMARY}>
        {busy ? "Saving…" : "Create the owner"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
