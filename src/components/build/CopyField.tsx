// A read-only code field with a copy button (the MCP connection page, ADR-047).
// Server pages pass the value in; this just renders it monospace and copies to
// the clipboard on click, matching ShareLink's copy affordance. No dependency.
"use client";

import { useState } from "react";

export default function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (insecure context); the value is still shown to copy
      // by hand.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 font-mono text-xs text-neutral-300">
        {value}
      </code>
      <button
        onClick={() => void copy()}
        className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-700"
        aria-label={label ? `Copy ${label}` : "Copy"}
      >
        {copied ? "copied ✓" : "copy"}
      </button>
    </div>
  );
}
