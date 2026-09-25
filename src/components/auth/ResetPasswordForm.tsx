"use client";
// The reset page's two steps (ADR-274): choose a new password, then save the
// fresh recovery kit and type one code back. Finishing switches this copy to
// password sign-in and signs this browser in.
import { useEffect, useRef, useState } from "react";
import RecoveryKit from "@/components/auth/RecoveryKit";
import { finishResetAtMachine, resetAtMachine } from "@/lib/auth/signin-actions";

const INPUT =
  "w-full rounded-card border border-line bg-surface-2 px-3 py-2 text-sm text-ink focus:border-line-strong focus:outline-none";
const PRIMARY =
  "rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

export default function ResetPasswordForm() {
  const ticket = useRef("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [kit, setKit] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The ticket rides after "#" so it never reaches a server log; keep it in
    // memory and drop it from the address bar.
    ticket.current = window.location.hash.slice(1);
    if (ticket.current) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function save() {
    // The link may also have landed on an already-open page (a hash change, no remount).
    if (!ticket.current) ticket.current = window.location.hash.slice(1);
    const token = ticket.current;
    setBusy(true);
    setError(null);
    try {
      const res = await resetAtMachine(token, pw, pw2);
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

  return (
    <div className="w-full max-w-lg rounded-card border border-line bg-surface-1 p-6">
      <h1 className="ui-title text-ink">Reset sign-in password</h1>
      <p className="mt-1 text-sm text-ink-muted">
        This page only works here, at the computer running Ledgr. Choose a new password, then save your new recovery
        kit. Your phone and other devices then sign in with the new password (a cloud copy picks it up at its next sync).
      </p>
      {!kit ? (
        <div className="mt-4 space-y-3">
          <label htmlFor="new-pw" className="block ui-meta">
            New password (at least 8 characters)
          </label>
          <input id="new-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={INPUT} />
          <label htmlFor="new-pw2" className="block ui-meta">
            Type it again
          </label>
          <input id="new-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={INPUT} />
          <button type="button" onClick={() => void save()} disabled={busy || !pw} className={PRIMARY}>
            {busy ? "Saving…" : "Save password"}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <RecoveryKit codes={kit} where={window.location.host} confirmLabel="Finish and sign in" onConfirm={finish} />
      )}
    </div>
  );
}
