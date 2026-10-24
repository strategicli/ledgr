// Microsoft mail/calendar provider verification: every Graph call is stubbed on
// globalThis.fetch (no network, no real mail). Asserts URLs, methods, headers and
// the Graph -> provider-neutral mapping. Run:
//   npx tsx scripts/verify-mail-microsoft.mts
process.env.MAIL_GRAPH_CLIENT_ID = "mail-client-id";
process.env.MAIL_GRAPH_CLIENT_SECRET = "mail-secret";
process.env.MAIL_GRAPH_TENANT_ID = "tenant-1";
process.env.GRAPH_MAILBOX_UPN = "boss@example.org";
delete process.env.MAIL_GRAPH_UPN;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const { getMicrosoftMail, getMicrosoftCalendar } = await import("../src/modules/mail/lib/microsoft");
const { MailProviderError } = await import("../src/modules/mail/lib/types");

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let tokenHits = 0;
// Next-response router: first matching [method, substring] wins.
let routes: [string, string, unknown, number?][] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const method = init?.method ?? "GET";
  if (url.host === "login.microsoftonline.com") {
    tokenHits += 1;
    const sent = String(init?.body);
    if (!sent.includes("client_id=mail-client-id")) throw new Error("wrong client at token endpoint");
    return Response.json({ access_token: "tok", expires_in: 3600 });
  }
  const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
  calls.push({ url, method, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const hit = routes.find(([m, s]) => m === method && (url.pathname + url.search).includes(s));
  if (!hit) return Response.json({ error: { message: `unrouted ${method} ${url.pathname}` } }, { status: 500 });
  const [, , payload, status = 200] = hit;
  return status === 204 ? new Response(null, { status }) : Response.json(payload, { status });
}) as typeof fetch;

function reset(r: typeof routes = []) {
  calls = [];
  routes = r;
}
const last = () => calls[calls.length - 1];
const decoded = (u: URL) => decodeURIComponent(u.pathname);

try {
  const mail = getMicrosoftMail();
  const cal = getMicrosoftCalendar();
  check("providers exist when creds + UPN are set", mail !== null && cal !== null);
  if (!mail || !cal) throw new Error("no providers");

  // --- headers + credentials ----------------------------------------------
  const msg = (o: object = {}) => ({
    id: "m1", conversationId: "c1", subject: "Hi", receivedDateTime: "2026-06-20T10:00:00Z",
    from: { emailAddress: { name: "Ann", address: "ann@x.org" } }, isRead: false,
    flag: { flagStatus: "flagged" }, categories: ["Red"], parentFolderId: "f1", ...o,
  });
  reset([["GET", "/messages", { value: [msg()] }]]);
  const page = await mail.listMessages({});
  check("mail request carries Prefer ImmutableId", last().headers.Prefer === 'IdType="ImmutableId"', last().headers.Prefer);
  check("request used the mail app's token (stub checks client_id)", tokenHits >= 1 && last().headers.authorization === "Bearer tok");
  check("requests go to the mailbox UPN", decoded(last().url).startsWith("/v1.0/users/boss@example.org/messages"));
  check("default order is receivedDateTime desc", last().url.searchParams.get("$orderby") === "receivedDateTime desc");
  check("summary mapping", page.messages[0].flagged && !page.messages[0].read && page.messages[0].tags[0] === "Red" && page.messages[0].folderIds[0] === "f1" && page.messages[0].from?.email === "ann@x.org");

  // --- search / unread / limit --------------------------------------------
  reset([["GET", "/mailFolders/f1/messages", { value: [] }]]);
  await mail.listMessages({ folderId: "f1", search: 'say "hi"', unreadOnly: true, limit: 500 });
  const sp = last().url.searchParams;
  check("search drops $orderby", sp.get("$orderby") === null);
  check("search term is double-quoted with inner quotes escaped", sp.get("$search") === '"say \\"hi\\""', String(sp.get("$search")));
  check("limit capped at 100", sp.get("$top") === "100");
  check("unreadOnly filter", sp.get("$filter") === "isRead eq false");

  // --- page token SSRF guard ----------------------------------------------
  reset();
  let rejected = false;
  try {
    await mail.listMessages({ pageToken: "https://evil.example/steal" });
  } catch (e) {
    rejected = e instanceof MailProviderError;
  }
  check("foreign pageToken rejected, nothing fetched", rejected && calls.length === 0);
  reset([["GET", "skiptoken=1", { value: [] }]]);
  await mail.listMessages({ pageToken: "https://graph.microsoft.com/v1.0/users/x/messages?$skiptoken=1" });
  check("Graph nextLink accepted as-is", calls.length === 1 && last().headers.Prefer === 'IdType="ImmutableId"');

  // --- modify -------------------------------------------------------------
  reset([
    ["GET", "$select=categories", { categories: ["Red", "Old"] }],
    ["PATCH", "/messages/m1", {}],
  ]);
  await mail.modify(["m1"], { read: true, flagged: false, addTags: ["Blue", "Red"], removeTags: ["Old"] });
  const patch = calls.find((c) => c.method === "PATCH")!;
  const b = patch.body as { isRead: boolean; flag: { flagStatus: string }; categories: string[] };
  check("modify merges categories (add, dedupe, remove)", JSON.stringify(b.categories) === '["Red","Blue"]', JSON.stringify(b.categories));
  check("modify sets isRead and flag", b.isRead === true && b.flag.flagStatus === "notFlagged");

  // --- move / archive / trash ---------------------------------------------
  reset([["POST", "/move", {}]]);
  await mail.archive(["m1"]);
  check("archive moves to well-known 'archive'", (last().body as { destinationId: string }).destinationId === "archive" && last().url.pathname.endsWith("/m1/move"));
  await mail.trash(["m2"]);
  check("trash moves to 'deleteditems'", (last().body as { destinationId: string }).destinationId === "deleteditems");
  await mail.move(["m3"], "folderX");
  check("move uses the given folder id", (last().body as { destinationId: string }).destinationId === "folderX");

  // --- createDraft: reply path --------------------------------------------
  reset([
    ["POST", "/messages/orig/createReply", { id: "d1" }],
    ["PATCH", "/messages/d1", {}],
    ["POST", "/messages/d1/attachments", {}],
  ]);
  const draft = await mail.createDraft({
    to: [], subject: "Re: Hi", html: "<p>yo</p>", inReplyTo: { messageId: "orig", mode: "reply" },
    cc: [{ name: null, email: "cc@x.org" }],
    attachments: [{ name: "a.txt", contentType: "text/plain", base64: "aGk=" }],
  });
  check("reply draft: createReply first (empty body), then PATCH, then attachment",
    calls.map((c) => `${c.method} ${c.url.pathname.split("/").slice(-2).join("/")}`).join(",") === "POST orig/createReply,PATCH messages/d1,POST d1/attachments",
    calls.map((c) => c.method).join());
  check("reply draft returns the new id", draft.id === "d1");
  const rp = calls[1].body as { body: { contentType: string }; toRecipients?: unknown; ccRecipients: unknown[] };
  check("reply PATCH sends HTML body, cc, and omits empty to", rp.body.contentType === "HTML" && rp.ccRecipients.length === 1 && rp.toRecipients === undefined);
  check("attachment is a fileAttachment", (calls[2].body as { "@odata.type": string })["@odata.type"] === "#microsoft.graph.fileAttachment");
  reset([["POST", "/messages", { id: "d2" }]]);
  await mail.createDraft({ to: [{ name: "Bo", email: "bo@x.org" }], subject: "S", html: "h" });
  check("fresh draft POSTs /messages with recipients", last().url.pathname.endsWith("/messages") && (last().body as { toRecipients: unknown[] }).toRecipients.length === 1);

  // --- delete / send (stubbed only) ---------------------------------------
  reset([["DELETE", "/messages/d1", {}, 204], ["POST", "/messages/d1/send", {}, 202]]);
  await mail.deleteDraft("d1");
  check("deleteDraft is DELETE /messages/{id}", calls[0].method === "DELETE");
  await mail.sendDraft("d1");
  check("sendDraft is POST /messages/{id}/send", calls[1].method === "POST" && calls[1].url.pathname.endsWith("/d1/send"));

  // --- folders ------------------------------------------------------------
  reset([
    ["GET", "/mailFolders/inbox?", { id: "F-IN" }],
    ["GET", "/mailFolders/archive?", { error: { message: "nf" } }, 404],
    ["GET", "/mailFolders/sentitems?", { id: "F-SENT" }],
    ["GET", "/mailFolders/drafts?", { id: "F-DR" }],
    ["GET", "/mailFolders/deleteditems?", { id: "F-DEL" }],
    ["GET", "/mailFolders/junkemail?", { id: "F-JUNK" }],
    ["GET", "/mailFolders/F-IN/childFolders", { value: [{ id: "F-KID", displayName: "Kid", unreadItemCount: 1 }] }],
    ["GET", "/mailFolders?", { value: [{ id: "F-IN", displayName: "Inbox", childFolderCount: 1, unreadItemCount: 4 }, { id: "F-DEL", displayName: "Deleted Items" }] }],
  ]);
  const folders = await mail.listFolders();
  const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
  check("folders: roles resolved, 404 archive tolerated", byId["F-IN"].role === "inbox" && byId["F-DEL"].role === "trash" && folders.length === 3);
  check("folders: nested child has parentId and no role", byId["F-KID"].parentId === "F-IN" && byId["F-KID"].role === null && byId["F-IN"].unread === 4);

  // --- tags ---------------------------------------------------------------
  reset([["GET", "/outlook/masterCategories", { value: [{ displayName: "Red", color: "preset0" }, { displayName: "Plain", color: "none" }] }]]);
  const tags = await mail.listTags();
  check("tags: preset -> hex, none -> null, id = name", tags[0].id === "Red" && /^#[0-9a-f]{6}$/.test(tags[0].color ?? "") && tags[1].color === null);

  // --- getMessage / getThread / attachment --------------------------------
  reset([
    ["GET", "/messages/m1/attachments?", { value: [{ id: "a1", name: "x.pdf", contentType: "application/pdf", size: 9, isInline: false }] }],
    ["GET", "/messages/m1?", msg({ hasAttachments: true, body: { contentType: "html", content: "<b>x</b>" }, ccRecipients: [{ emailAddress: { address: "c@x.org" } }], webLink: "https://o/w" })],
  ]);
  const full = await mail.getMessage("m1");
  check("getMessage: html body, attachment meta, cc", full.bodyHtml === "<b>x</b>" && full.bodyText === null && full.attachments[0].name === "x.pdf" && full.attachments[0].contentId === null && full.cc[0].email === "c@x.org");
  reset([["GET", "/messages?", { value: [msg({ id: "m2", receivedDateTime: "2026-06-21T10:00:00Z" }), msg({ id: "m1" })] }]]);
  const thread = await mail.getThread("it's");
  check("getThread: filter escapes quote, no $orderby, sorted ascending", last().url.searchParams.get("$filter") === "conversationId eq 'it''s'" && last().url.searchParams.get("$orderby") === null && thread.map((t) => t.id).join() === "m1,m2");
  reset([["GET", "/attachments/a1", { name: "x.txt", contentType: "text/plain", contentBytes: "aGk=" }]]);
  const att = await mail.getAttachment("m1", "a1");
  check("getAttachment decodes base64", new TextDecoder().decode(att.bytes) === "hi");

  // --- error mapping ------------------------------------------------------
  reset([["GET", "/messages", { error: { message: "Access is denied" } }, 403]]);
  let err: unknown;
  try {
    await mail.listMessages({});
  } catch (e) {
    err = e;
  }
  check("non-2xx -> MailProviderError(request, status) with Graph message",
    err instanceof MailProviderError && err.kind === "request" && err.status === 403 && err.message.includes("Access is denied"));

  // --- calendar -----------------------------------------------------------
  const ev = (o: object = {}) => ({
    id: "e1", subject: "Standup", start: { dateTime: "2026-06-20T15:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-06-20T15:30:00.0000000", timeZone: "UTC" }, isAllDay: false,
    organizer: { emailAddress: { name: "Org", address: "org@x.org" } },
    attendees: [
      { emailAddress: { address: "a@x.org" }, status: { response: "tentativelyAccepted" } },
      { emailAddress: { address: "b@x.org" }, status: { response: "notResponded" } },
      { emailAddress: { address: "c@x.org" }, status: { response: "declined" } },
    ],
    responseStatus: { response: "accepted" }, isOrganizer: false,
    onlineMeeting: { joinUrl: "https://teams/j" }, seriesMasterId: "s1", ...o,
  });
  reset([
    ["GET", "page2", { value: [ev({ id: "e2", isOrganizer: true })] }],
    ["GET", "/calendarView", { value: [ev()], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/x/calendarView?page2" }],
  ]);
  const events = await cal.listEvents("2026-06-20T00:00:00Z", "2026-06-27T00:00:00Z");
  check("calendar Prefer has ImmutableId and UTC together", last().headers.Prefer === 'IdType="ImmutableId", outlook.timezone="UTC"', last().headers.Prefer);
  check("calendar paging follows nextLink", events.length === 2 && calls.length === 2);
  check("calendar times: UTC + Z -> ISO instant", events[0].start === "2026-06-20T15:00:00.000Z" && events[0].end === "2026-06-20T15:30:00.000Z");
  check("calendar attendee response map", events[0].attendees.map((a) => a.response).join() === "tentative,none,declined");
  check("myResponse from responseStatus, organizer wins", events[0].myResponse === "accepted" && events[1].myResponse === "organizer");
  check("join url, series, calendarId", events[0].joinUrl === "https://teams/j" && events[0].seriesId === "s1" && events[0].calendarId === "default");

  reset([["POST", "/events", ev()]]);
  await cal.createEvent({ title: "T", start: "2026-06-20T15:00:00Z", end: "2026-06-20T16:00:00Z", attendees: [{ name: null, email: "a@x.org" }], body: "<p>b</p>", teamsMeeting: true });
  const cb = last().body as Record<string, never> & { start: { dateTime: string; timeZone: string }; attendees: { type: string }[]; isOnlineMeeting: boolean; onlineMeetingProvider: string; body: { contentType: string } };
  check("createEvent payload", cb.start.dateTime === "2026-06-20T15:00:00.000" && cb.start.timeZone === "UTC" && cb.attendees[0].type === "required" && cb.isOnlineMeeting === true && cb.onlineMeetingProvider === "teamsForBusiness" && cb.body.contentType === "HTML");
  reset([["PATCH", "/events/e1", ev()]]);
  await cal.updateEvent("e1", { title: "New" });
  check("updateEvent sends only provided fields", JSON.stringify(last().body) === '{"subject":"New"}', JSON.stringify(last().body));
  reset([["POST", "/accept", {}, 202], ["POST", "/tentativelyAccept", {}, 202], ["POST", "/decline", {}, 202], ["DELETE", "/events/e1", {}, 204]]);
  await cal.respond("e1", "accept", "yes");
  await cal.respond("e1", "tentative");
  await cal.respond("e1", "decline");
  await cal.deleteEvent("e1");
  check("respond verbs + sendResponse", calls.slice(0, 3).map((c) => c.url.pathname.split("/").pop()).join() === "accept,tentativelyAccept,decline" && (calls[0].body as { sendResponse: boolean; comment: string }).sendResponse === true && (calls[0].body as { comment: string }).comment === "yes");
  check("deleteEvent is DELETE", last().method === "DELETE");

  // --- not configured -----------------------------------------------------
  delete process.env.GRAPH_MAILBOX_UPN;
  delete process.env.ONEDRIVE_EXPORT_UPN;
  check("factories return null without a UPN", getMicrosoftMail() === null && getMicrosoftCalendar() === null);
} finally {
  globalThis.fetch = realFetch;
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
