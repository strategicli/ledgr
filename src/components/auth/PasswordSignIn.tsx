"use client";
// The built-in sign-in form (ADR-274): one password box, plus "Use a recovery
// code" for when the password is lost. The owner's email rides along in a
// hidden username field so password managers save the pair and fill it (Face
// ID on a phone).
import { useActionState, useState } from "react";
import { signInWithPassword, signInWithRecoveryCode, type FormState } from "@/lib/auth/signin-actions";

const INPUT =
  "w-full rounded-card border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none";
const PRIMARY =
  "w-full rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

export default function PasswordSignIn({ email, redirectUrl }: { email: string; redirectUrl: string }) {
  const [mode, setMode] = useState<"password" | "code">("password");
  const [pwState, pwAction, pwBusy] = useActionState<FormState, FormData>(signInWithPassword, null);
  const [codeState, codeAction, codeBusy] = useActionState<FormState, FormData>(signInWithRecoveryCode, null);

  return (
    <div className="w-full max-w-sm rounded-card border border-line bg-surface-1 p-6">
      <h1 className="ui-title text-ink">Sign in to Ledgr</h1>
      {mode === "password" ? (
        <form key="password" action={pwAction} className="mt-4 space-y-3">
          <input type="hidden" name="redirect_url" value={redirectUrl} />
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
          />
          <label htmlFor="password" className="block ui-meta">
            Password
          </label>
          <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required className={INPUT} />
          <button type="submit" disabled={pwBusy} className={PRIMARY}>
            {pwBusy ? "Signing in…" : "Sign in"}
          </button>
          {pwState?.error && <p className="text-xs text-red-400">{pwState.error}</p>}
          <button type="button" onClick={() => setMode("code")} className="text-xs text-ink-subtle underline underline-offset-2">
            Forgot it? Use a recovery code
          </button>
        </form>
      ) : (
        <form key="code" action={codeAction} className="mt-4 space-y-3">
          <label htmlFor="code" className="block ui-meta">
            One code from your recovery kit (each works once)
          </label>
          <input
            id="code"
            name="code"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            required
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className={`${INPUT} font-mono`}
          />
          <button type="submit" disabled={codeBusy} className={PRIMARY}>
            {codeBusy ? "Checking…" : "Sign in with the code"}
          </button>
          {codeState?.error && <p className="text-xs text-red-400">{codeState.error}</p>}
          <p className="text-xs text-ink-subtle">
            No kit either? At the computer running Ledgr, right-click the tray icon and choose Reset sign-in password.
          </p>
          <button type="button" onClick={() => setMode("password")} className="text-xs text-ink-subtle underline underline-offset-2">
            Back to the password
          </button>
        </form>
      )}
    </div>
  );
}
