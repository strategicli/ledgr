// Offline check of the reading layer (swapInlineImages + the combined inbox).
// fetch is stubbed for both providers; no network, no real mail.
// Run: npx tsx scripts/verify-mail-reading.mts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ledgr-mail-reading-"));
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

const { swapInlineImages, listMessages } = await import("../src/modules/mail/lib/reading");

// --- swapInlineImages -------------------------------------------------------
const png = (cid: string, base64 = "AAAA", contentType = "image/png") => ({ contentId: cid, contentType, base64 });
check("cid match is case-insensitive", swapInlineImages('<img src="cid:Logo@X">', [png("logo@x")]) === '<img src="data:image/png;base64,AAAA">');
check("single quotes work", swapInlineImages("<img src='cid:a'>", [png("a")]) === "<img src='data:image/png;base64,AAAA'>");
check("double quotes work", swapInlineImages('<img src="cid:a">', [png("a")]) === '<img src="data:image/png;base64,AAAA">');
{
  const html = '<img src="cid:a">';
  check("non-image types ignored", swapInlineImages(html, [png("a", "AAAA", "application/pdf"), png("a", "AAAA", "image/svg+xml")]) === html);
}
{
  const html = '<img src="cid:a"><img src="cid:zzz">';
  const out = swapInlineImages(html, [png("a")]);
  check("unknown cid left alone", out === '<img src="data:image/png;base64,AAAA"><img src="cid:zzz">', out);
}
{
  const html = '<img src="cid:big"><img src="cid:small">';
  const big = "A".repeat(8 * 1024 * 1024 + 1);
  const out = swapInlineImages(html, [png("big", big), png("small")]);
  check("image over the 8 MB budget skipped, later small one kept", out === '<img src="cid:big"><img src="data:image/png;base64,AAAA">');
}

// --- combined inbox ---------------------------------------------------------
type Call = { method: string; url: URL };
let calls: Call[] = [];
let failOutlook = false;
let failGmail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const method = init?.method ?? "GET";
  if (url.host === "login.microsoftonline.com") return Response.json({ access_token: "ms-tok", expires_in: 3600 });
  if (url.host === "oauth2.googleapis.com") return Response.json({ access_token: "g-tok", expires_in: 3600 });
  calls.push({ method, url });
  const path = decodeURIComponent(url.pathname);
  if (url.host === "graph.microsoft.com") {
    if (failOutlook) return Response.json({ error: { message: "outlook down" } }, { status: 500 });
    if (path.endsWith("/mailFolders/inbox/messages")) {
      return Response.json({
        value: [
          { id: "o1", receivedDateTime: "2026-06-20T12:00:00Z" },
          { id: "o2", receivedDateTime: "2026-06-20T08:00:00Z" },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
      });
    }
    if (path.endsWith("/next")) return Response.json({ value: [{ id: "o3", receivedDateTime: "2026-06-20T07:00:00Z" }] });
  }
  if (url.host === "gmail.googleapis.com") {
    if (failGmail) return Response.json({ error: { message: "gmail down" } }, { status: 500 });
    if (path.endsWith("/messages")) return Response.json({ messages: [{ id: "g1" }, { id: "g2" }] }); // no next token: exhausted
    const id = path.split("/").pop()!;
    const ts = id === "g1" ? "2026-06-20T10:00:00Z" : "2026-06-20T06:00:00Z";
    return Response.json({ id, threadId: id, internalDate: String(Date.parse(ts)), payload: { headers: [] } });
  }
  return Response.json({ error: { message: `unrouted ${method} ${url}` } }, { status: 599 });
}) as typeof fetch;

try {
  const r1 = await listMessages({ account: "all" });
  check("merged newest-first across accounts", r1.messages.map((m) => m.id).join() === "o1,g1,o2,g2", r1.messages.map((m) => m.id).join());
  check("no errors on a clean run", r1.errors.length === 0);
  const g = calls.find((c) => c.url.host === "gmail.googleapis.com" && c.url.pathname.endsWith("/messages"));
  check("Gmail asked for label INBOX", g?.url.searchParams.getAll("labelIds").join() === "INBOX");
  check("Outlook asked for folder inbox", calls.some((c) => c.url.host === "graph.microsoft.com" && c.url.pathname.endsWith("/mailFolders/inbox/messages")));
  check("no folder-list calls", !calls.some((c) => /\/labels|\/mailFolders$/.test(c.url.pathname)));
  check("next token present (Outlook has more, Gmail exhausted)", r1.nextPageToken !== null);

  calls = [];
  const r2 = await listMessages({ account: "all", pageToken: r1.nextPageToken! });
  check("page 2 resumes Outlook from its own token", calls.some((c) => c.url.host === "graph.microsoft.com" && c.url.pathname.endsWith("/next")));
  check("exhausted Gmail not queried on page 2", !calls.some((c) => c.url.host === "gmail.googleapis.com"));
  check("page 2 returns Outlook's remaining message and ends", r2.messages.map((m) => m.id).join() === "o3" && r2.nextPageToken === null);

  failOutlook = true;
  const r3 = await listMessages({ account: "all" });
  check("Outlook failing reports it and keeps Gmail", r3.errors.length === 1 && r3.errors[0].account === "microsoft" && r3.messages.map((m) => m.id).join() === "g1,g2");
  failOutlook = false;
  failGmail = true;
  const r4 = await listMessages({ account: "all" });
  check("Gmail failing reports it and keeps Outlook", r4.errors.length === 1 && r4.errors[0].account === "gmail" && r4.messages.map((m) => m.id).join() === "o1,o2");
} finally {
  globalThis.fetch = realFetch;
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
