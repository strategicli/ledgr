// T5 verification (ADR-080): the offline capture outbox. Pure client logic, so
// it runs under node with a localStorage + fetch shim (no DB). Covers enqueue,
// flush-on-success (each synced entry removed), stop-on-offline (throw) and
// stop-on-server-error (!ok) leaving the queue intact, and double-flush safety.
// Run: npx tsx scripts/verify-outbox.mts

// --- Shims so the client module's `window`/`localStorage` guards pass --------
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;
(globalThis as unknown as { window: unknown }).window = globalThis;

// A controllable fetch: mode "ok" resolves 200, "bad" resolves 500, "offline"
// throws (network error). Counts calls so we can assert no double-post.
let fetchMode: "ok" | "bad" | "offline" = "ok";
let fetchCalls = 0;
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
  fetchCalls += 1;
  if (fetchMode === "offline") throw new TypeError("offline");
  return { ok: fetchMode === "ok" } as Response;
}) as typeof fetch;

const { enqueueCapture, outboxCount, flushOutbox } = await import("../src/lib/outbox");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

console.log("\n# Offline capture outbox");
store.clear();
enqueueCapture({ type: "unmarked", title: "first", inbox: true });
enqueueCapture({ type: "task", title: "second", inbox: true });
check("enqueue grows the queue", outboxCount() === 2);

// Offline: a flush posts nothing and leaves everything queued.
fetchMode = "offline";
fetchCalls = 0;
let r = await flushOutbox();
check("offline flush syncs nothing", r.synced === 0 && r.remaining === 2, `synced=${r.synced} remaining=${r.remaining}`);
check("offline flush stops after the first failure", fetchCalls === 1, `calls=${fetchCalls}`);

// Server error (reachable but !ok): also leaves the queue intact.
fetchMode = "bad";
r = await flushOutbox();
check("server-error flush keeps the queue", r.remaining === 2);

// Back online: a flush drains the whole queue.
fetchMode = "ok";
r = await flushOutbox();
check("online flush syncs all", r.synced === 2 && r.remaining === 0, `synced=${r.synced} remaining=${r.remaining}`);
check("queue is empty after a full flush", outboxCount() === 0);

// Double-flush safety: re-flushing an empty queue posts nothing.
fetchCalls = 0;
r = await flushOutbox();
check("re-flush of an empty queue is a no-op", r.synced === 0 && fetchCalls === 0);

// A partial drain: one entry, online — synced and removed; the new entry after
// it survives a subsequent offline flush.
enqueueCapture({ type: "unmarked", title: "third", inbox: true });
fetchMode = "ok";
await flushOutbox();
enqueueCapture({ type: "unmarked", title: "fourth", inbox: true });
fetchMode = "offline";
r = await flushOutbox();
check("new offline entry survives", r.remaining === 1 && outboxCount() === 1);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
