// Offline check of the Gmail + Google Calendar providers. fetch is stubbed, so
// no real network and never real mail. Run: npx tsx scripts/verify-mail-google.mts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway hub folder holding fake Google sign-in details.
const dir = mkdtempSync(join(tmpdir(), "ledgr-mail-google-"));
process.env.LEDGR_SUPERVISOR_DIR = dir;
delete process.env.MAIL_GOOGLE_CLIENT_ID;
delete process.env.MAIL_GOOGLE_CLIENT_SECRET;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { getGmail, GmailProvider, parseAddressList, decodeEntities } = await import("../src/modules/mail/lib/gmail");
const { getGoogleCalendar, GoogleCalendarProvider } = await import("../src/modules/mail/lib/google-calendar");
const { MailProviderError } = await import("../src/modules/mail/lib/types");
const { _resetGoogleTokenForTests } = await import("../src/modules/mail/lib/google-auth");

// --- fetch stub -----------------------------------------------------------
type Call = { method: string; url: string; body: unknown };
type Reply = [number, unknown] | undefined;
let calls: Call[] = [];
let routes: ((c: Call) => Reply)[] = [];
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return Response.json({ access_token: "fake-token", expires_in: 3600 });
  }
  const call: Call = { method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
  calls.push(call);
  for (const r of routes) {
    const out = r(call);
    if (out) return new Response(out[1] === null ? null : JSON.stringify(out[1]), { status: out[0] });
  }
  return new Response(JSON.stringify({ error: { message: `no stub for ${method} ${url}` } }), { status: 599 });
}) as typeof fetch;
const on = (method: string, urlPart: string, status: number, body: unknown) =>
  routes.push((c) => (c.method === method && c.url.includes(urlPart) ? [status, body] : undefined));
const reset = () => {
  calls = [];
  routes = [];
};
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// --- not signed in -> null -------------------------------------------------
check("getGmail() null with no store file", getGmail() === null);
writeFileSync(join(dir, "mail-accounts.json"), JSON.stringify({ google: { clientId: "id", clientSecret: "secret" } }));
check("getGmail() null without refresh token", getGmail() === null && getGoogleCalendar() === null);
writeFileSync(
  join(dir, "mail-accounts.json"),
  JSON.stringify({ google: { clientId: "id", clientSecret: "secret", refreshToken: "refresh" } })
);
check("getGmail()/getGoogleCalendar() set once connected", getGmail() instanceof GmailProvider && getGoogleCalendar() instanceof GoogleCalendarProvider);
_resetGoogleTokenForTests();

// --- address parser --------------------------------------------------------
check("parse bare address", JSON.stringify(parseAddressList("a@b.com")) === JSON.stringify([{ name: null, email: "a@b.com" }]));
check("parse Name <a@b>", JSON.stringify(parseAddressList("Ann Lee <a@b.com>")) === JSON.stringify([{ name: "Ann Lee", email: "a@b.com" }]));
{
  const l = parseAddressList('"Lee, Ann" <a@b.com>, Bob <b@c.org>,c@d.net');
  check("parse quoted comma + list", l.length === 3 && l[0].name === "Lee, Ann" && l[1].email === "b@c.org" && l[2].email === "c@d.net");
  check("parse empty", parseAddressList("").length === 0 && parseAddressList(undefined).length === 0);
}
check("decode entities", decodeEntities("Tom &amp; Jerry&#39;s &quot;x&quot; &lt;b&gt;") === `Tom & Jerry's "x" <b>`);

const gm = new GmailProvider();
const G = "https://gmail.googleapis.com/gmail/v1/users/me";

// --- getMessage: MIME walk + base64url decode ------------------------------
const bodyText = "Héllo wörld ✓ 日本";
const fullMsg = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD", "STARRED", "Label_7", "CATEGORY_UPDATES"],
  snippet: "Tom &amp; Jerry",
  internalDate: "1700000000000",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: '"Lee, Ann" <ann@x.com>' },
      { name: "To", value: "me@x.com, Bob <bob@x.com>" },
      { name: "Cc", value: "cc@x.com" },
      { name: "Reply-To", value: "reply@x.com" },
      { name: "Subject", value: "Hi" },
      { name: "Message-ID", value: "<abc@x.com>" },
    ],
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64u(bodyText) } },
          { mimeType: "text/html", body: { data: b64u(`<p>${bodyText}</p>`) } },
        ],
      },
      { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "att1", size: 10 }, headers: [{ name: "Content-Disposition", value: 'attachment; filename="a.pdf"' }] },
      {
        mimeType: "image/png",
        filename: "logo.png",
        body: { attachmentId: "att2", size: 5 },
        headers: [
          { name: "Content-Disposition", value: "inline; filename=logo.png" },
          { name: "Content-ID", value: "<logo123>" },
        ],
      },
    ],
  },
};
reset();
on("GET", "/messages/m1?format=full", 200, fullMsg);
{
  const m = await gm.getMessage("m1");
  check("html body decoded incl. non-ASCII", m.bodyHtml === `<p>${bodyText}</p>`);
  check("text body decoded incl. non-ASCII", m.bodyText === bodyText);
  check("two attachments found", m.attachments.length === 2);
  const [pdf, img] = m.attachments;
  check("pdf attachment not inline", pdf.id === "att1" && !pdf.inline && pdf.contentId === null && pdf.contentType === "application/pdf");
  check("inline image has contentId stripped of <>", img.inline && img.contentId === "logo123");
  check("headers mapped", m.from?.name === "Lee, Ann" && m.to.length === 2 && m.cc[0].email === "cc@x.com" && m.replyTo[0].email === "reply@x.com");
  check("flags/tags/receivedAt", !m.read && m.flagged && m.tags.join() === "Label_7" && m.receivedAt === new Date(1700000000000).toISOString());
  check("preview decoded, hasAttachments, webLink", m.preview === "Tom & Jerry" && m.hasAttachments && m.webLink === "https://mail.google.com/mail/u/0/#all/t1");
}

// getThread + getAttachment
reset();
on("GET", "/threads/t1?format=full", 200, { messages: [fullMsg, { ...fullMsg, id: "m2" }] });
check("getThread maps every message", (await gm.getThread("t1")).map((m) => m.id).join() === "m1,m2");
reset();
on("GET", "/messages/m1/attachments/att1", 200, { data: Buffer.from([0, 1, 2, 250, 255]).toString("base64url") });
on("GET", "/messages/m1?format=full", 200, fullMsg);
{
  const a = await gm.getAttachment("m1", "att1");
  check("getAttachment bytes + name + type", a.bytes.join() === "0,1,2,250,255" && a.name === "a.pdf" && a.contentType === "application/pdf");
}

// --- folders ---------------------------------------------------------------
reset();
on("GET", "/labels/", 200, { id: "x", name: "x" }); // overridden below by specific routes (first match wins)
routes = [];
const labelDefs = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "SENT", name: "SENT", type: "system" },
  { id: "STARRED", name: "STARRED", type: "system" },
  { id: "Label_1", name: "Work", type: "user" },
  { id: "Label_2", name: "Work/Budget", type: "user", color: { backgroundColor: "#16a766" } },
];
on("GET", "/labels/INBOX", 200, { ...labelDefs[0], messagesUnread: 4 });
on("GET", "/labels/SENT", 200, { ...labelDefs[1], messagesUnread: 0 });
on("GET", "/labels/Label_1", 200, { ...labelDefs[3], messagesUnread: 2 });
on("GET", "/labels/Label_2", 200, { ...labelDefs[4], messagesUnread: 1 });
on("GET", "/labels", 200, { labels: labelDefs });
{
  const f = await gm.listFolders();
  check("folders: roles + unread", f.find((x) => x.id === "INBOX")?.role === "inbox" && f.find((x) => x.id === "INBOX")?.unread === 4);
  check("folders: STARRED skipped", !f.some((x) => x.id === "STARRED"));
  check("folders: nested parentId", f.find((x) => x.id === "Label_2")?.parentId === "Label_1" && f.find((x) => x.id === "Label_1")?.parentId === null);
  const arch = f.find((x) => x.id === "ARCHIVE");
  check("folders: synthetic ARCHIVE", arch?.role === "archive" && arch.name === "All archived");
  const t = await gm.listTags();
  check("tags: user labels only, colour", t.length === 2 && t[1].color === "#16a766" && t[0].color === null);
}

// --- listMessages ----------------------------------------------------------
reset();
on("GET", "/messages?", 200, { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "np" });
on("GET", "/messages/m", 200, fullMsg);
{
  const page = await gm.listMessages({ folderId: "ARCHIVE", search: "invoice", unreadOnly: true, limit: 500, pageToken: "pt" });
  const u = new URL(calls[0].url);
  check("ARCHIVE uses q, not labelIds", !u.searchParams.has("labelIds") && u.searchParams.get("q") === "-in:inbox -in:sent -in:drafts -in:trash -in:spam invoice is:unread", u.searchParams.get("q") ?? "");
  check("limit capped at 100, pageToken passed", u.searchParams.get("maxResults") === "100" && u.searchParams.get("pageToken") === "pt");
  check("page: nextPageToken + 2 summaries", page.nextPageToken === "np" && page.messages.length === 2);
  check("metadata fetch asks for headers", calls[1].url.includes("format=metadata") && calls[1].url.includes("metadataHeaders=Message-ID"));
}
reset();
on("GET", "/messages?", 200, {});
{
  await gm.listMessages({ folderId: "Label_1" });
  const u = new URL(calls[0].url);
  check("label folder uses labelIds, default limit 50", u.searchParams.get("labelIds") === "Label_1" && u.searchParams.get("maxResults") === "50" && !u.searchParams.has("q"));
}

// --- modify / move / archive / trash --------------------------------------
reset();
on("POST", "/messages/batchModify", 200, null);
on("POST", "/trash", 200, {});
await gm.modify(["a", "b"], { read: true, flagged: true, addTags: ["Label_1"], removeTags: ["Label_2"] });
{
  const b = calls[0].body as { ids: string[]; addLabelIds: string[]; removeLabelIds: string[] };
  check("modify: read+flag+tags label math", b.ids.join() === "a,b" && b.addLabelIds.join() === "Label_1,STARRED" && b.removeLabelIds.join() === "Label_2,UNREAD");
}
await gm.modify(["a"], { read: false, flagged: false });
{
  const b = calls[1].body as { addLabelIds: string[]; removeLabelIds: string[] };
  check("modify: unread + unstar", b.addLabelIds.join() === "UNREAD" && b.removeLabelIds.join() === "STARRED");
}
await gm.move(["a"], "Label_1");
await gm.move(["a"], "INBOX");
await gm.archive(["a"]);
{
  const b = (i: number) => calls[i].body as { addLabelIds: string[]; removeLabelIds: string[] };
  check("move removes INBOX", b(2).addLabelIds.join() === "Label_1" && b(2).removeLabelIds.join() === "INBOX");
  check("move to INBOX keeps INBOX", b(3).addLabelIds.join() === "INBOX" && b(3).removeLabelIds.length === 0);
  check("archive removes INBOX", b(4).addLabelIds.length === 0 && b(4).removeLabelIds.join() === "INBOX");
}
await gm.trash(["a", "b"]);
check("trash posts per message", calls.slice(5).map((c) => c.url.replace(G, "")).join() === "/messages/a/trash,/messages/b/trash");

// --- createDraft -----------------------------------------------------------
function decodeRaw(raw: string) {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [head, ...rest] = text.split("\r\n\r\n");
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n")) {
    const i = line.indexOf(":");
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { text, headers, body: rest.join("\r\n\r\n") };
}
reset();
on("GET", "/messages/orig?", 200, {
  id: "orig",
  threadId: "T9",
  payload: { headers: [{ name: "Message-ID", value: "<orig@x.com>" }, { name: "References", value: "<root@x.com>" }, { name: "Subject", value: "Plan" }] },
});
on("POST", "/drafts", 200, { id: "d1" });
{
  const r = await gm.createDraft({
    to: [{ name: "Lee, Ann", email: "ann@x.com" }],
    cc: [{ name: null, email: "cc@x.com" }],
    subject: "Re: Plan – café ✓",
    html: "<p>Héllo ✓</p>",
    inReplyTo: { messageId: "orig", mode: "reply" },
    attachments: [{ name: "n.txt", contentType: "text/plain", base64: Buffer.from("hi").toString("base64") }],
  });
  const body = calls.find((c) => c.method === "POST")!.body as { message: { raw: string; threadId?: string } };
  const d = decodeRaw(body.message.raw);
  check("draft returns id", r.id === "d1");
  check("reply: threadId passed", body.message.threadId === "T9");
  check("reply: In-Reply-To + References", d.headers["in-reply-to"] === "<orig@x.com>" && d.headers["references"] === "<root@x.com> <orig@x.com>");
  check("To quoted, Cc present, no From", d.headers["to"] === '"Lee, Ann" <ann@x.com>' && d.headers["cc"] === "cc@x.com" && !("from" in d.headers));
  const enc = d.headers["subject"].match(/^=\?UTF-8\?B\?(.+)\?=$/);
  check("non-ASCII subject RFC 2047 encoded", !!enc && Buffer.from(enc[1], "base64").toString("utf8") === "Re: Plan – café ✓");
  check("MIME headers + html part + attachment part", d.headers["mime-version"] === "1.0" && d.headers["content-type"].startsWith("multipart/mixed") && d.text.includes("text/html; charset=UTF-8") && d.text.includes('Content-Disposition: attachment; filename="n.txt"'));
  const htmlB64 = d.body.split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
  check("html part base64 decodes", Buffer.from(htmlB64, "base64").toString("utf8") === "<p>Héllo ✓</p>");
}
reset();
on("POST", "/drafts", 200, { id: "d2" });
await gm.createDraft({ to: [{ name: null, email: "a@b.com" }], subject: "Fwd: x", html: "x", inReplyTo: { messageId: "orig", mode: "forward" } });
{
  const body = calls[0].body as { message: { raw: string; threadId?: string } };
  const d = decodeRaw(body.message.raw);
  check("forward: no threading headers, no threadId, no fetch of original", calls.length === 1 && !body.message.threadId && !d.headers["in-reply-to"] && !d.headers["references"]);
}

// --- delete / send / errors ------------------------------------------------
reset();
on("DELETE", "/drafts/d1", 204, null);
on("POST", "/drafts/send", 200, { id: "m" });
await gm.deleteDraft("d1");
await gm.sendDraft("d1");
check("deleteDraft + sendDraft", calls[0].method === "DELETE" && (calls[1].body as { id: string }).id === "d1");
reset();
on("GET", "/messages/zzz", 404, { error: { message: "Requested entity was not found." } });
try {
  await gm.getMessage("zzz");
  check("non-2xx throws", false);
} catch (e) {
  check("non-2xx -> MailProviderError(request, status, Google message)", e instanceof MailProviderError && e.kind === "request" && e.status === 404 && e.message === "Requested entity was not found.");
}

// --- calendar --------------------------------------------------------------
const gc = new GoogleCalendarProvider();
const C = "https://www.googleapis.com/calendar/v3/calendars/primary";
reset();
on("GET", "/events?", 200, {
  items: [
    { id: "e1", summary: "Retreat", start: { date: "2026-11-02" }, end: { date: "2026-11-04" }, organizer: { email: "o@x.com", self: true }, recurringEventId: "series1" },
    {
      id: "e2",
      summary: "Standup",
      description: "<b>Agenda</b> &amp; notes",
      start: { dateTime: "2026-11-02T15:00:00-06:00" },
      end: { dateTime: "2026-11-02T15:30:00-06:00" },
      organizer: { email: "boss@x.com", displayName: "Boss" },
      attendees: [{ email: "boss@x.com" }, { email: "me@x.com", self: true, responseStatus: "needsAction" }, { email: "z@x.com", responseStatus: "accepted", displayName: "Z" }],
      conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://meet.example/abc" }] },
      htmlLink: "https://cal/e2",
    },
  ],
  nextPageToken: "p2",
});
on("GET", "pageToken=p2", 200, { items: [{ id: "e3", summary: "Late", start: { dateTime: "2026-11-03T10:00:00Z" }, end: { dateTime: "2026-11-03T11:00:00Z" }, hangoutLink: "https://meet.google.com/x", attendees: [{ email: "me@x.com", self: true, responseStatus: "tentative" }] }] });
{
  // the page-2 route must win over the generic one
  routes.unshift(routes.pop()!);
  const ev = await gc.listEvents("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
  const u = new URL(calls[0].url);
  check("listEvents params", u.searchParams.get("singleEvents") === "true" && u.searchParams.get("orderBy") === "startTime" && u.searchParams.get("maxResults") === "250" && u.searchParams.get("timeMin") === "2026-11-01T00:00:00Z");
  check("listEvents pages", ev.length === 3 && calls.length === 2);
  const [allDay, timed, last] = ev;
  check("all-day mapping", allDay.allDay && allDay.start === "2026-11-02T00:00:00.000Z" && allDay.end === "2026-11-04T00:00:00.000Z" && allDay.seriesId === "series1" && allDay.calendarId === "primary");
  check("organizer self -> myResponse organizer", allDay.myResponse === "organizer");
  check("needsAction -> none", timed.myResponse === "none" && timed.attendees[0].response === "none" && timed.attendees[2].response === "accepted");
  check("timed event mapping", !timed.allDay && timed.start === "2026-11-02T21:00:00.000Z" && timed.organizer?.name === "Boss" && timed.webLink === "https://cal/e2");
  check("joinUrl from conferenceData video", timed.joinUrl === "https://meet.example/abc");
  check("bodyPreview stripped of tags", timed.bodyPreview === "Agenda &amp; notes");
  check("hangoutLink wins, tentative", last.joinUrl === "https://meet.google.com/x" && last.myResponse === "tentative");
}

reset();
on("POST", "/events?sendUpdates=all", 200, { id: "n1", summary: "New", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } });
on("PATCH", "/events/n1?sendUpdates=all", 200, { id: "n1", summary: "Renamed", start: { date: "2026-12-01" }, end: { date: "2026-12-02" } });
on("DELETE", "/events/n1?sendUpdates=all", 204, null);
{
  const e = await gc.createEvent({ title: "New", start: "2026-12-01T00:00:00.000Z", end: "2026-12-02T00:00:00.000Z", allDay: true, attendees: [{ name: "A", email: "a@x.com" }], teamsMeeting: true });
  const b = calls[0].body as Record<string, { date?: string }>;
  check("createEvent all-day uses {date}", b.start.date === "2026-12-01" && b.end.date === "2026-12-02" && e.allDay && !("conferenceData" in b));
  await gc.updateEvent("n1", { title: "Renamed" });
  check("updateEvent sends only provided fields", JSON.stringify(calls[1].body) === JSON.stringify({ summary: "Renamed" }) && calls[1].method === "PATCH");
  await gc.deleteEvent("n1");
  check("deleteEvent sendUpdates=all", calls[2].method === "DELETE" && calls[2].url === `${C}/events/n1?sendUpdates=all`);
}

reset();
on("GET", "/events/r1", 200, {
  id: "r1",
  attendees: [{ email: "boss@x.com", responseStatus: "accepted" }, { email: "me@x.com", self: true, responseStatus: "needsAction" }],
});
on("PATCH", "/events/r1?sendUpdates=all", 200, { id: "r1" });
await gc.respond("r1", "decline", "Out sick");
{
  const patch = calls.find((c) => c.method === "PATCH")!;
  const att = (patch.body as { attendees: { email: string; responseStatus: string; comment?: string }[] }).attendees;
  check("respond: only attendees in the patch body", Object.keys(patch.body as object).join() === "attendees");
  check("respond: self declined with comment", att[1].responseStatus === "declined" && att[1].comment === "Out sick");
  check("respond: others untouched", att[0].responseStatus === "accepted" && att[0].comment === undefined);
}
reset();
on("GET", "/events/r2", 200, { id: "r2", attendees: [{ email: "boss@x.com", responseStatus: "accepted" }] });
try {
  await gc.respond("r2", "accept");
  check("respond without self attendee throws", false);
} catch (e) {
  check("respond without self attendee throws MailProviderError", e instanceof MailProviderError && !calls.some((c) => c.method === "PATCH"));
}

// --- getInlineImages ---------------------------------------------------------
reset();
{
  const raw = Buffer.from([0xfb, 0xff, 0xfe, 0x3e, 0x3f]); // standard base64 has + / and padding
  const urlSafe = raw.toString("base64url");
  const std = raw.toString("base64");
  const img = (cid: string | null, extra: object, mime = "image/png") => ({
    mimeType: mime,
    headers: cid ? [{ name: "Content-ID", value: cid }] : [],
    ...extra,
  });
  on("GET", "/messages/mi?format=full", 200, {
    id: "mi",
    threadId: "t",
    payload: {
      mimeType: "multipart/related",
      parts: [
        { mimeType: "text/html", body: { data: b64u('<img src="cid:a">') } },
        img("<a>", { body: { data: urlSafe, size: 5 } }),
        img("<b>", { filename: "b.png", body: { attachmentId: "att-b", size: 5 } }),
        img(null, { body: { data: urlSafe } }),
        img("<d>", { body: { data: urlSafe } }, "application/pdf"),
      ],
    },
  });
  on("GET", "/messages/mi/attachments/att-b", 200, { data: urlSafe });
  const out = await gm.getInlineImages("mi");
  check("inline images: only image parts with a Content-ID", out.map((i) => i.contentId).join() === "a,b", JSON.stringify(out.map((i) => i.contentId)));
  check("inline images: body.data path makes no attachment call", out[0].base64 === std && calls.filter((c) => c.url.includes("/attachments/")).length === 1);
  check("inline images: attachmentId path fetches data", out[1].base64 === std && calls.some((c) => c.url.endsWith("/attachments/att-b")));
  check("inline images: base64url converted to standard base64 with padding", /[+/]/.test(out[0].base64) && out[0].base64.endsWith("=") && !/[-_]/.test(out[0].base64) && out[0].contentType === "image/png");
}
reset();
on("GET", "/messages/mc?format=full", 200, {
  id: "mc",
  threadId: "t",
  payload: {
    mimeType: "multipart/related",
    parts: Array.from({ length: 30 }, (_, i) => ({ mimeType: "image/png", headers: [{ name: "Content-ID", value: `<c${i}>` }], body: { data: "AAAA" } })),
  },
});
check("inline images: capped at 20", (await gm.getInlineImages("mc")).length === 20);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
