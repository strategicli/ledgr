// Offline check of the mail acting layer (parseAct + act). fetch is stubbed for
// both providers; no network, no real mail.
// Run: npx tsx scripts/verify-mail-acting.mts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ledgr-mail-acting-"));
process.env.LEDGR_SUPERVISOR_DIR = dir;
process.env.MAIL_GRAPH_CLIENT_ID = "mail-client-id";
process.env.MAIL_GRAPH_CLIENT_SECRET = "mail-secret";
process.env.MAIL_GRAPH_TENANT_ID = "tenant-1";
process.env.GRAPH_MAILBOX_UPN = "boss@example.org";
delete process.env.MAIL_GRAPH_UPN;
delete process.env.MAIL_GOOGLE_CLIENT_ID;
delete process.env.MAIL_GOOGLE_CLIENT_SECRET;
writeFileSync(
  join(dir, "mail-accounts.json"),
  JSON.stringify({ google: { clientId: "id", clientSecret: "secret", refreshToken: "refresh" } })
);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { parseAct, act } = await import("../src/modules/mail/lib/acting");

// --- parseAct ---------------------------------------------------------------
const item = { account: "gmail", id: "g1" };
const p = (body: unknown) => parseAct(body);
const withAction = (action: unknown, items: unknown = [item]) => p({ items, action });

check("rejects non-object", p(null) === null && p("x") === null && p(undefined) === null && p(5) === null);
check("rejects missing/empty items", p({ action: { kind: "archive" } }) === null && withAction({ kind: "archive" }, []) === null);
check("rejects >100 items, accepts 100", withAction({ kind: "archive" }, Array.from({ length: 101 }, () => item)) === null && withAction({ kind: "archive" }, Array.from({ length: 100 }, () => item)) !== null);
check("rejects missing action", p({ items: [item] }) === null);
check("rejects bad account", withAction({ kind: "archive" }, [{ account: "yahoo", id: "x" }]) === null);
check("rejects null item", withAction({ kind: "archive" }, [null]) === null);
check("rejects empty id", withAction({ kind: "archive" }, [{ account: "gmail", id: "" }]) === null);
check("rejects oversized id (>1024), accepts 1024", withAction({ kind: "archive" }, [{ account: "gmail", id: "x".repeat(1025) }]) === null && withAction({ kind: "archive" }, [{ account: "gmail", id: "x".repeat(1024) }]) !== null);
check("rejects non-string id", withAction({ kind: "archive" }, [{ account: "gmail", id: 7 }]) === null);
check("rejects unknown kind", withAction({ kind: "nuke" }) === null && withAction({}) === null);
check("read/flag need a boolean", withAction({ kind: "read" }) === null && withAction({ kind: "read", value: "true" }) === null && withAction({ kind: "flag", value: 1 }) === null);
check("tags reject non-string entries", withAction({ kind: "tags", add: [1], remove: [] }) === null && withAction({ kind: "tags", add: [], remove: [null] }) === null);
check("tags reject missing lists", withAction({ kind: "tags", add: [] }) === null);
check("tags reject >50 entries, accept 50", withAction({ kind: "tags", add: Array.from({ length: 51 }, (_, i) => `t${i}`), remove: [] }) === null && withAction({ kind: "tags", add: Array.from({ length: 50 }, (_, i) => `t${i}`), remove: [] }) !== null);
check("move/restore need a folderId", withAction({ kind: "move" }) === null && withAction({ kind: "restore" }) === null && withAction({ kind: "move", folderId: "" }) === null && withAction({ kind: "restore", folderId: 3 }) === null);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
check("accepts read", same(withAction({ kind: "read", value: true })?.action, { kind: "read", value: true }));
check("accepts flag", same(withAction({ kind: "flag", value: false })?.action, { kind: "flag", value: false }));
check("accepts tags", same(withAction({ kind: "tags", add: ["a"], remove: ["b"] })?.action, { kind: "tags", add: ["a"], remove: ["b"] }));
check("accepts move", same(withAction({ kind: "move", folderId: "f" })?.action, { kind: "move", folderId: "f" }));
check("accepts restore", same(withAction({ kind: "restore", folderId: "inbox" })?.action, { kind: "restore", folderId: "inbox" }));
check("accepts archive and trash", same(withAction({ kind: "archive" })?.action, { kind: "archive" }) && same(withAction({ kind: "trash" })?.action, { kind: "trash" }));
{
  const r = p({ items: [{ account: "microsoft", id: "o1", extra: "x" }], action: { kind: "move", folderId: "f", evil: 1 }, other: 1 });
  check("unknown extra fields dropped", same(r, { items: [{ account: "microsoft", id: "o1" }], action: { kind: "move", folderId: "f" } }), JSON.stringify(r));
}

// --- act --------------------------------------------------------------------
type Call = { method: string; url: URL; body: unknown };
let calls: Call[] = [];
let failGmail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const method = init?.method ?? "GET";
  if (url.host === "login.microsoftonline.com") return Response.json({ access_token: "ms-tok", expires_in: 3600 });
  if (url.host === "oauth2.googleapis.com") return Response.json({ access_token: "g-tok", expires_in: 3600 });
  calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  if (url.host === "gmail.googleapis.com") {
    if (failGmail) return Response.json({ error: { message: "gmail down" } }, { status: 500 });
    return Response.json({});
  }
  if (url.host === "graph.microsoft.com") return Response.json({});
  return Response.json({ error: { message: "unrouted" } }, { status: 599 });
}) as typeof fetch;

const gmailCalls = () => calls.filter((c) => c.url.host === "gmail.googleapis.com");
const graphCalls = () => calls.filter((c) => c.url.host === "graph.microsoft.com");
const gpath = (c: Call) => c.url.pathname.replace("/gmail/v1/users/me", "");
const mixed = [
  { account: "gmail", id: "g1" },
  { account: "microsoft", id: "o1" },
  { account: "gmail", id: "g2" },
  { account: "microsoft", id: "o2" },
] as const;

try {
  // read: Gmail one batchModify, Outlook per-message PATCH
  let errs = await act([...mixed], { kind: "read", value: true });
  check("mixed read: no errors", errs.length === 0);
  check("Gmail grouped into exactly one batchModify", gmailCalls().length === 1 && gpath(gmailCalls()[0]) === "/messages/batchModify" && (gmailCalls()[0].body as { ids: string[] }).ids.join() === "g1,g2");
  check("Outlook got one PATCH per message", graphCalls().length === 2 && graphCalls().every((c) => c.method === "PATCH") && graphCalls().map((c) => decodeURIComponent(c.url.pathname).split("/").pop()).sort().join() === "o1,o2");

  // trash never deletes
  calls = [];
  errs = await act([...mixed], { kind: "trash" });
  check("trash: no errors", errs.length === 0);
  check("trash: never a DELETE to either API", !calls.some((c) => c.method === "DELETE"));
  check("trash: Gmail uses per-id trash endpoint", gmailCalls().map((c) => `${c.method} ${gpath(c)}`).join() === "POST /messages/g1/trash,POST /messages/g2/trash");
  check("trash: Outlook moves to deleteditems", graphCalls().length === 2 && graphCalls().every((c) => c.method === "POST" && c.url.pathname.endsWith("/move") && (c.body as { destinationId: string }).destinationId === "deleteditems"));

  // restore
  calls = [];
  errs = await act([...mixed], { kind: "restore", folderId: "inbox" });
  check("restore: no errors", errs.length === 0);
  check("restore: Outlook POST move with the given folderId", graphCalls().length === 2 && graphCalls().every((c) => c.method === "POST" && c.url.pathname.endsWith("/move") && (c.body as { destinationId: string }).destinationId === "inbox"));
  check("restore: Gmail POST untrash per id", gmailCalls().map((c) => `${c.method} ${gpath(c)}`).join() === "POST /messages/g1/untrash,POST /messages/g2/untrash");

  // Gmail failing: reported, Outlook still happened
  calls = [];
  failGmail = true;
  errs = await act([...mixed], { kind: "archive" });
  check("Gmail 500 returns a single gmail error", errs.length === 1 && errs[0].account === "gmail" && errs[0].error.length > 0, JSON.stringify(errs));
  check("Outlook part still happened", graphCalls().length === 2 && graphCalls().every((c) => (c.body as { destinationId: string }).destinationId === "archive"));
  failGmail = false;
} finally {
  globalThis.fetch = realFetch;
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
