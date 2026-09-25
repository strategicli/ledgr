"use client";
// The recovery kit (ADR-274): ten one-time codes shown once, with Download and
// Print, and a box where the owner types one back to prove it was saved. Used
// by User Settings and by the reset page at the machine; the caller decides
// what "confirmed" unlocks.
import { useState } from "react";

const BTN =
  "rounded-card border border-line-strong bg-surface-2 px-3 py-1.5 text-sm text-ink hover:bg-surface-3 disabled:opacity-50";
const PRIMARY =
  "rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-3.5 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/25 disabled:opacity-50";

function kitText(codes: string[], where: string): string {
  return [
    "Ledgr recovery kit",
    `For: ${where}`,
    `Made: ${new Date().toLocaleString()}`,
    "",
    "Each code signs you in ONCE if you forget your password.",
    "On the sign-in page choose \"Use a recovery code\". Keep this somewhere safe,",
    "away from your password. Making a new kit in User Settings voids these.",
    "",
    ...codes.map((c, i) => `${String(i + 1).padStart(2, " ")}. ${c}`),
    "",
  ].join("\r\n");
}

export default function RecoveryKit({
  codes,
  where,
  confirmLabel,
  onConfirm,
}: {
  codes: string[];
  // The address this kit belongs to, printed on it.
  where: string;
  confirmLabel: string;
  // Resolves to an error message, or null when accepted.
  onConfirm: (code: string) => Promise<string | null>;
}) {
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function download() {
    const blob = new Blob([kitText(codes, where)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ledgr-recovery-kit.txt";
    a.click();
    URL.revokeObjectURL(a.href);
    setSaved(true);
  }

  function print() {
    const w = window.open("", "_blank", "width=640,height=760");
    if (!w) return;
    const pre = w.document.createElement("pre");
    pre.textContent = kitText(codes, where);
    pre.style.font = "16px/1.6 ui-monospace, Consolas, monospace";
    w.document.title = "Ledgr recovery kit";
    w.document.body.appendChild(pre);
    w.focus();
    w.print();
    setSaved(true);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setError(await onConfirm(code));
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-card border border-amber-700/60 bg-amber-950/20 p-4">
      <p className="text-sm font-medium text-amber-300">Your recovery kit. It is shown once.</p>
      <p className="mt-1 text-xs text-ink-muted">
        If you forget your password, each code signs you in one time. Download or print it now and keep it somewhere
        safe, away from your password.
      </p>
      <ol className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-sm text-ink sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={download} className={BTN}>
          Download
        </button>
        <button type="button" onClick={print} className={BTN}>
          Print
        </button>
      </div>
      <label htmlFor="kit-confirm" className="mt-4 block ui-meta">
        {saved ? "Now type any one of the codes to prove the kit is saved." : "Once it's saved, type any one of the codes here."}
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          id="kit-confirm"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim()) void confirm();
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className="w-64 rounded-card border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
        />
        <button type="button" onClick={() => void confirm()} disabled={!code.trim() || busy} className={PRIMARY}>
          {busy ? "Checking…" : confirmLabel}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
