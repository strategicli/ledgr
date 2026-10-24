"use client";

// The client half of the mail options: save an app's IDs, forget a sign-in,
// and a read-only "Test" that lists each account's folders.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountCheck } from "@/modules/mail/lib/accounts";

const INPUT = "w-full rounded-card border border-line bg-surface-1 px-2 py-1 text-ink";
const BUTTON = "rounded-card border border-line-strong px-3 py-1 text-ink hover:bg-surface-2 disabled:opacity-50";

async function call(method: string, url: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Failed (${res.status})`;
}

function AppForm({
  fields,
  save,
  replacing,
  closedLabel = "Replace the app details",
}: {
  fields: { key: string; label: string; secret?: boolean; optional?: boolean }[];
  save: (values: Record<string, string>) => unknown;
  replacing: boolean;
  closedLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!replacing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className="ui-meta text-ink-subtle underline" onClick={() => setOpen(true)}>
        {closedLabel}
      </button>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        const err = await call("PUT", "/api/mail/accounts", save(data));
        setBusy(false);
        setError(err);
        if (!err) {
          setOpen(false);
          router.refresh();
        }
      }}
    >
      {fields.map((f) => (
        <label key={f.key} className="block space-y-1">
          <span className="ui-meta text-ink-muted">
            {f.label}
            {f.optional && " (optional)"}
          </span>
          <input name={f.key} type={f.secret ? "password" : "text"} autoComplete="off" required={!f.optional} className={INPUT} />
        </label>
      ))}
      {error && <p className="text-red-400">{error}</p>}
      <button type="submit" disabled={busy} className={BUTTON}>
        {busy ? "Saving…" : "Save on this computer"}
      </button>
    </form>
  );
}

export function MicrosoftForm({ replacing, ownApp }: { replacing: boolean; ownApp: boolean }) {
  return (
    <AppForm
      replacing={replacing}
      closedLabel={ownApp ? undefined : "Set up the sending app now (optional)"}
      fields={[
        { key: "clientId", label: "Application (client) ID" },
        { key: "clientSecret", label: "Client secret value", secret: true },
        { key: "tenantId", label: "Directory (tenant) ID, if different from Ledgr's", optional: true },
      ]}
      save={(v) => ({ microsoft: { clientId: v.clientId, clientSecret: v.clientSecret, tenantId: v.tenantId || undefined } })}
    />
  );
}

export function GoogleForm({ replacing }: { replacing: boolean }) {
  return (
    <AppForm
      replacing={replacing}
      fields={[
        { key: "clientId", label: "Google client ID" },
        { key: "clientSecret", label: "Google client secret", secret: true },
      ]}
      save={(v) => ({ google: { clientId: v.clientId, clientSecret: v.clientSecret } })}
    />
  );
}

export function ForgetButton({ account, label }: { account: "gmail" | "microsoft"; label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="ui-meta text-ink-subtle underline"
      onClick={async () => {
        await call("DELETE", `/api/mail/accounts?account=${account}`);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}

function describe(name: string, c: AccountCheck): string | null {
  if (!c) return null;
  return c.ok
    ? `${name}: working. ${c.folders} folders, ${c.inboxUnread} unread in the inbox.`
    : `${name}: not working. ${c.error}`;
}

export function CheckButton() {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        className={BUTTON}
        onClick={async () => {
          setBusy(true);
          const res = await fetch("/api/mail/accounts?check=1");
          const data = (await res.json().catch(() => ({}))) as {
            check?: { microsoft: AccountCheck; gmail: AccountCheck };
            error?: string;
          };
          setBusy(false);
          setLines(
            data.check
              ? [describe("Outlook", data.check.microsoft), describe("Gmail", data.check.gmail)].filter((l): l is string => !!l)
              : [data.error ?? `Test failed (${res.status})`]
          );
        }}
      >
        {busy ? "Testing…" : "Test the connections"}
      </button>
      <p className="ui-meta text-ink-subtle">Only reads your folder list. Nothing is sent or changed.</p>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
