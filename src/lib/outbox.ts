// Offline capture outbox (T5, ADR-080): the native replacement for the Todoist
// inbox pull-in (ADR-010/026) as the offline-capture path. When a quick capture
// can't reach the server (offline, or a transient failure), it's queued locally
// and flushed on reconnect — so capture never loses a thought, no third-party
// app needed.
//
// localStorage, not IndexedDB: capture payloads are tiny (a title + a few
// fields) and a single user, so a synchronous JSON array is plenty and far
// simpler (Principle 5). Client-only (guards `window`), so it's import-safe from
// server components that render a client child. Background Sync is deliberately
// NOT used (iOS PWAs don't support it); a flush on `online`/load is robust
// cross-platform.

const KEY = "ledgr.outbox.v1";

export type OutboxEntry = {
  // A client-generated id so a flush can remove exactly what it sent (and a
  // double-flush can't double-post the same queued capture).
  id: string;
  // The POST /api/items payload (type, title, inbox, optional date/urgency).
  payload: Record<string, unknown>;
  ts: number;
};

function read(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* quota or privacy mode: dropping is better than throwing mid-capture */
  }
}

function makeId(): string {
  // crypto.randomUUID where available; a cheap fallback otherwise.
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function enqueueCapture(payload: Record<string, unknown>): OutboxEntry {
  const entry: OutboxEntry = { id: makeId(), payload, ts: Date.now() };
  write([...read(), entry]);
  return entry;
}

export function outboxCount(): number {
  return read().length;
}

// Try to POST every queued capture. Each success is removed immediately (so a
// crash mid-flush never re-sends a sent one); a failure leaves the rest queued
// for the next flush. Returns how many synced and how many remain.
export async function flushOutbox(): Promise<{ synced: number; remaining: number }> {
  let synced = 0;
  for (const entry of read()) {
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.payload),
      });
      if (!res.ok) break; // server reachable but rejected/erroring — stop, retry later
      write(read().filter((e) => e.id !== entry.id));
      synced += 1;
    } catch {
      break; // still offline — leave everything queued
    }
  }
  return { synced, remaining: read().length };
}
