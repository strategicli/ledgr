"use client";
// On a fresh cloud copy's /setup page (ADR-277): type the code your main Ledgr
// is showing on Build → Network. That computer then copies everything here.
import { useState } from "react";
import { submitPairingCode } from "@/lib/sync/pairing-actions";

const INPUT =
  "w-full rounded-card border border-line bg-surface-2 px-3 py-2 font-mono text-lg tracking-widest text-ink focus:border-line-strong focus:outline-none";
const PRIMARY =
  "rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

export default function PairingCodeForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await submitPairingCode(code);
      if (res.ok) setSent(true);
      else setError(res.error ?? "That didn't work. Try again.");
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-ink-muted">
        Got it. Go back to your main Ledgr: it picks this up within a few seconds and starts copying. When it says it
        is done, come back here and sign in with the password you use there.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <label htmlFor="pair-code" className="block ui-meta">
        Pairing code
      </label>
      <input
        id="pair-code"
        autoComplete="off"
        placeholder="ABCD-EFGH-JKMN"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className={INPUT}
      />
      <button type="button" onClick={() => void send()} disabled={busy || !code.trim()} className={PRIMARY}>
        {busy ? "Sending…" : "Pair"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
