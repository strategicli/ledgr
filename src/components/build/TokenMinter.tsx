// Mint-a-token button + once-shown token display (ADR-160). The server action
// (passed in) does the owner-gated signing; this just drives the click, surfaces
// the raw token once in a CopyField, and reassures that minting is additive
// (a new token never invalidates the last). Disabled with a hint when the
// purpose's signing secret isn't configured yet.
"use client";

import { useState } from "react";
import CopyField from "@/components/build/CopyField";
import type { MintResult } from "@/lib/auth/mint-actions";

export default function TokenMinter({
  action,
  noun,
  disabled,
  disabledHint,
}: {
  action: () => Promise<MintResult>;
  noun: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if ("token" in res) setToken(res.token);
      else setError(res.error);
    } catch {
      setError("Couldn't generate a token — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return <p className="text-xs text-amber-500/90">{disabledHint}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => void mint()}
        disabled={busy}
        className="self-start rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50"
      >
        {busy ? "Generating…" : token ? `Generate another ${noun}` : `Generate ${noun}`}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {token && (
        <div>
          <CopyField value={token} label={noun} />
          <p className="mt-1 text-xs text-amber-500/90">
            Copy this now — it&rsquo;s shown only once. Generating another token
            won&rsquo;t affect this one.
          </p>
        </div>
      )}
    </div>
  );
}
