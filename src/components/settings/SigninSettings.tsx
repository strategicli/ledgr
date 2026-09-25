"use client";
// User Settings → Sign-in (ADR-274): the password, the recovery kit, this
// copy's sign-in method, and the sessions signed in with the password here.
//
// Deliberately NOT a multi-select list surface: the sessions table is a small
// management list where each sign-out is per-row and deliberate, the same
// ADR-118 exception API credentials and Synced devices take.
import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";
import RecoveryKit from "@/components/auth/RecoveryKit";
import {
  checkRecoveryCode,
  newRecoveryKit,
  revokeSignInSession,
  setOwnerPassword,
  signOut,
  signOutEverywhere,
  switchToDefault,
  switchToPassword,
} from "@/lib/auth/signin-actions";
import type { SessionSummary } from "@/lib/auth/builtin";
import { RECOVERY_LOW } from "@/lib/auth/builtin-core";
import { relativeTime } from "@/lib/relative-time";

const INPUT =
  "w-full max-w-xs rounded-card border border-line bg-surface-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none";
const BTN =
  "rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3 disabled:opacity-50";
const PRIMARY =
  "rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

export type SigninSettingsProps = {
  // This copy's method: "builtin" or the default (Clerk / no sign-in).
  method: "builtin" | null;
  // What the default is on this copy.
  defaultLabel: "Clerk" | "No sign-in (this computer only)" | null;
  passwordSet: boolean;
  codesLeft: number;
  sessions: SessionSummary[];
  // Signed in right now with a password session (so Sign out applies).
  builtinSignedIn: boolean;
  // A Clerk sign-in in this browser that belongs to this owner.
  clerkLinkedHere: boolean;
  // LEDGR_SIGNIN_METHOD is set: the emergency override decides, not the switch.
  overridden: boolean;
  where: string;
  recovered: boolean;
};

export default function SigninSettings(p: SigninSettingsProps) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [kit, setKit] = useState<string[] | null>(null);
  const [switchPw, setSwitchPw] = useState("");
  const [switchCode, setSwitchCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: true; kit?: string[]; notice?: string } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      if (res.kit) setKit(res.kit);
      if (res.notice) setMsg(res.notice);
      router.refresh();
      return true;
    } catch {
      setError("That didn't work. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const onPassword = p.method === "builtin";

  return (
    <section id="sign-in" className="mt-10 border-t border-line pt-6">
      <h2 className="ui-section-label">Sign-in</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Your Ledgr password works on every copy of Ledgr you run, because it syncs. Which way each copy signs in is set
        per copy, here. This copy: <span className="text-ink">{onPassword ? "your password" : (p.defaultLabel ?? "not set up")}</span>.
      </p>
      {p.recovered && (
        <p className="mt-2 rounded-card border border-amber-700/60 bg-amber-950/20 p-3 text-sm text-amber-300">
          You signed in with a recovery code, which is now used up. Set a new password below.
        </p>
      )}

      {/* Password */}
      <div className="mt-4 rounded-card border border-line bg-surface-1 p-4">
        <p className="ui-row text-ink">{p.passwordSet ? "Change your password" : "Set a password"}</p>
        <p className="mt-0.5 text-xs text-ink-subtle">
          You don&rsquo;t need the old one: being signed in here is enough. At least 8 characters; a password manager&rsquo;s
          suggestion is ideal.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <input type="password" autoComplete="new-password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} className={INPUT} aria-label="New password" />
          <input type="password" autoComplete="new-password" placeholder="Type it again" value={pw2} onChange={(e) => setPw2(e.target.value)} className={INPUT} aria-label="Type the new password again" />
          <div>
            <button
              type="button"
              disabled={busy || !pw}
              className={PRIMARY}
              onClick={() =>
                void run(() => setOwnerPassword(pw, pw2)).then((ok) => {
                  if (ok) {
                    setSwitchPw(pw);
                    setPw("");
                    setPw2("");
                  }
                })
              }
            >
              {p.passwordSet ? "Change password" : "Set password"}
            </button>
          </div>
        </div>
      </div>

      {/* Recovery kit */}
      {kit ? (
        <RecoveryKit
          codes={kit}
          where={p.where}
          confirmLabel={onPassword ? "I saved it" : "I saved it, continue"}
          onConfirm={async (code) => {
            const check = await checkRecoveryCode(code);
            if (!check.ok) return check.error;
            setSwitchCode(code);
            setKit(null);
            setMsg(onPassword ? "Kit saved. Your old codes no longer work." : "Kit saved. Now switch this copy to your password below.");
            return null;
          }}
        />
      ) : (
        p.passwordSet && (
          <div className="mt-4 rounded-card border border-line bg-surface-1 p-4">
            <p className="ui-row text-ink">Recovery codes</p>
            <p className={`mt-0.5 text-sm ${p.codesLeft <= RECOVERY_LOW ? "text-amber-300" : "text-ink-muted"}`}>
              {p.codesLeft === 0
                ? "None left. Make a new kit so you can get back in if you forget your password."
                : `${p.codesLeft} of 10 left.${p.codesLeft <= RECOVERY_LOW ? " Running low: make a new kit." : ""}`}
            </p>
            <div className="mt-3">
              <ConfirmButton
                onConfirm={async () => {
                  const ok = await run(() => newRecoveryKit());
                  if (!ok) throw new Error("Couldn't make a new kit.");
                }}
                title="Make a new recovery kit?"
                description="You get ten new codes. Every code from your current kit stops working."
                confirmLabel="Make new kit"
                tone="primary"
                panelClassName="w-72"
                trigger="New recovery kit"
                triggerClassName={BTN}
              />
            </div>
          </div>
        )
      )}

      {/* This copy's method */}
      <div className="mt-4 rounded-card border border-line bg-surface-1 p-4">
        <p className="ui-row text-ink">How this copy signs in</p>
        {p.overridden && (
          <p className="mt-1 text-xs text-amber-300">
            The emergency setting LEDGR_SIGNIN_METHOD is in force on this copy, so this switch has no effect until it is
            removed.
          </p>
        )}
        {onPassword ? (
          <>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Password sign-in is on.
              {p.defaultLabel === "Clerk" &&
                " Clerk sign-in still works too, so switching back is safe. To switch back, first sign in with Clerk in this browser (Sign-in page → Sign in with Clerk instead)."}
            </p>
            {p.defaultLabel && (
              <div className="mt-3">
                <ConfirmButton
                  onConfirm={async () => {
                    const ok = await run(() => switchToDefault());
                    if (!ok) throw new Error("Couldn't switch.");
                  }}
                  title={p.defaultLabel === "Clerk" ? "Switch this copy to Clerk?" : "Stop asking for a password here?"}
                  description={
                    p.defaultLabel === "Clerk"
                      ? "The sign-in page will show Clerk. Your password keeps working as the second way in."
                      : "Anyone who can reach this copy of Ledgr gets in without a password. Only do this if it is reachable from this computer alone."
                  }
                  confirmLabel="Switch"
                  tone="primary"
                  panelClassName="w-80"
                  disabled={p.defaultLabel === "Clerk" && !p.clerkLinkedHere}
                  trigger={p.defaultLabel === "Clerk" ? "Switch to Clerk" : "Turn off password sign-in"}
                  triggerClassName={BTN}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-0.5 text-xs text-ink-subtle">
              To switch this copy to your password, type it and one recovery code. That proves both work before anything
              changes, and this browser stays signed in.
              {p.defaultLabel === "Clerk" && " Clerk sign-in keeps working as a second way in."}
            </p>
            {!p.passwordSet ? (
              <p className="mt-2 text-xs text-ink-faint">Set a password above first.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                <input type="password" autoComplete="current-password" placeholder="Your password" value={switchPw} onChange={(e) => setSwitchPw(e.target.value)} className={INPUT} aria-label="Your password" />
                <input
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="One recovery code"
                  value={switchCode}
                  onChange={(e) => setSwitchCode(e.target.value)}
                  className={`${INPUT} font-mono`}
                  aria-label="One recovery code"
                />
                <div>
                  <button
                    type="button"
                    disabled={busy || !switchPw || !switchCode || p.codesLeft === 0}
                    className={PRIMARY}
                    onClick={() => void run(() => switchToPassword(switchPw, switchCode))}
                  >
                    Switch this copy to my password
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {/* Sessions */}
      {(p.sessions.length > 0 || p.builtinSignedIn) && (
        <div className="mt-4 rounded-card border border-line bg-surface-1 p-4">
          <p className="ui-row text-ink">Signed in with your password on this copy</p>
          <ul className="mt-2 divide-y divide-line/60">
            {p.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block ui-row text-ink">
                    {s.label}
                    {s.current && <span className="ml-2 rounded bg-surface-3 px-1.5 py-0.5 text-xs text-ink-subtle">this browser</span>}
                  </span>
                  <span className="block ui-meta">
                    signed in {relativeTime(s.createdAt)}, last used {relativeTime(s.lastSeenAt)}
                  </span>
                </span>
                {!s.current && (
                  <button type="button" className={BTN} disabled={busy} onClick={() => void run(() => revokeSignInSession(s.id))}>
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.builtinSignedIn && (
              <form action={signOut}>
                <button type="submit" className={BTN}>
                  Sign out
                </button>
              </form>
            )}
            <ConfirmButton
              onConfirm={() => signOutEverywhere()}
              title="Sign out everywhere?"
              description="Every browser and phone signed in with your password on this copy is signed out, this one included."
              confirmLabel="Sign out everywhere"
              panelClassName="w-72"
              trigger="Sign out everywhere"
              triggerClassName={BTN}
            />
          </div>
        </div>
      )}
    </section>
  );
}
