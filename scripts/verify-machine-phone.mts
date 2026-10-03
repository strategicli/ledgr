// ADR-288 verification: the machine API routes the Android client (Steward)
// needs: items inbox/updatedSince filters, ?include=relations, DELETE relations,
// notifications, search, favorites, type statuses/properties, capture routes,
// and transcript attach.
//
// Runs the real route handlers against the dev DB with a real minted
// credential, like verify-machine-read.mts (DB-backed, so verify-ci.mjs
// classifies it local/manual).
//   npx tsx scripts/verify-machine-phone.mts
//
// Deliberately NOT exercised: PATCH notifications { markAllRead: true } happy
// path, because it would mark the dev owner's real unread notifications read.
// Its validation branches and the ids path are covered.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { eq, inArray } = await import("drizzle-orm");
const { getDb } = await import("../src/db");
const { apiCredentials, items, notifications } = await import("../src/db/schema");
const { createCredential, revokeCredential } = await import("../src/lib/auth/credentials");
const { resolveMachineOwner } = await import("../src/lib/machine/owner");
const { createItem } = await import("../src/lib/item-mutations");
const { listRelatedItems } = await import("../src/lib/relations");
const { getSettings } = await import("../src/lib/settings");
const itemsRoute = await import("../src/app/api/machine/items/route");
const itemRoute = await import("../src/app/api/machine/items/[id]/route");
const relationsRoute = await import("../src/app/api/machine/relations/route");
const typesRoute = await import("../src/app/api/machine/types/route");
const notificationsRoute = await import("../src/app/api/machine/notifications/route");
const unreadRoute = await import("../src/app/api/machine/notifications/unread-count/route");
const searchRoute = await import("../src/app/api/machine/search/route");
const favoritesRoute = await import("../src/app/api/machine/favorites/route");
const captureRoutesRoute = await import("../src/app/api/machine/capture-routes/route");
const transcriptsRoute = await import("../src/app/api/machine/meetings/[id]/transcripts/route");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = await resolveMachineOwner();
if (!ownerId) {
  console.error("No machine owner. Set DEV_USER_EMAIL in .env.local and seed the dev DB.");
  process.exit(1);
}

const made = await createCredential(ownerId, `verify-machine-phone ${Date.now()}`, ["api"]);
if (!made.ok) {
  console.error(`could not mint a credential: ${made.error}`);
  process.exit(1);
}
const AUTH = `Basic ${Buffer.from(`${made.keyId}:${made.secret}`).toString("base64")}`;

const URL_BASE = "https://x.test/api/machine";
type Handler = (req: Request, ctx: never) => Promise<Response> | Response;
// Call a handler as an authenticated (default) or anonymous client.
const call = (
  h: Handler,
  path: string,
  init: { method?: string; body?: unknown; anon?: boolean } = {},
  ctx?: unknown
) =>
  (h as (r: Request, c?: unknown) => Promise<Response>)(
    new Request(`${URL_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(init.anon ? {} : { authorization: AUTH }),
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    ctx
  );
const jsonOf = async (r: Response) => r.json();

const createdItems: string[] = [];
const createdNotifications: string[] = [];
const stamp = `zq${Date.now().toString(36)}`;
const settingsBefore = await getSettings(ownerId);
// The notification routes honor the notification-center module switch, like the
// session routes do. Turn it on for the run (restored in finally) so the happy
// path is testable on an owner who has it off.
const { updateSettings } = await import("../src/lib/settings");
await updateSettings(ownerId, {
  modules: { ...settingsBefore.modules, "notification-center": true, "meeting-transcripts": true },
});

try {
  // --- auth required + CORS preflight on every new route --------------------
  const anon: [string, Handler, string, string, unknown?][] = [
    ["GET /notifications", notificationsRoute.GET, "/notifications", "GET"],
    ["PATCH /notifications", notificationsRoute.PATCH, "/notifications", "PATCH"],
    ["GET /notifications/unread-count", unreadRoute.GET, "/notifications/unread-count", "GET"],
    ["GET /search", searchRoute.GET, "/search?q=a", "GET"],
    ["GET /favorites", favoritesRoute.GET, "/favorites", "GET"],
    ["POST /favorites", favoritesRoute.POST, "/favorites", "POST"],
    ["PATCH /favorites", favoritesRoute.PATCH, "/favorites", "PATCH"],
    ["GET /capture-routes", captureRoutesRoute.GET, "/capture-routes", "GET"],
    ["DELETE /relations", relationsRoute.DELETE, "/relations", "DELETE"],
    ["GET /items", itemsRoute.GET, "/items?inbox=true", "GET"],
  ];
  for (const [name, h, path, method] of anon) {
    const r = await call(h, path, { method, anon: true, body: method === "GET" ? undefined : {} });
    check(`${name} without a token is 401`, r.status === 401, String(r.status));
  }
  {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const r = await call(
      transcriptsRoute.POST,
      `/meetings/${fakeId}/transcripts`,
      { method: "POST", anon: true, body: { text: "x" } },
      { params: Promise.resolve({ id: fakeId }) }
    );
    check("POST /meetings/<id>/transcripts without a token is 401", r.status === 401);
    const one = await call(itemRoute.GET, `/items/${fakeId}?include=relations`, { anon: true }, {
      params: Promise.resolve({ id: fakeId }),
    });
    check("GET /items/<id>?include=relations without a token is 401", one.status === 401);
  }
  for (const [name, mod] of [
    ["notifications", notificationsRoute],
    ["search", searchRoute],
    ["favorites", favoritesRoute],
    ["capture-routes", captureRoutesRoute],
    ["transcripts", transcriptsRoute],
  ] as const) {
    const r = (mod as { OPTIONS: () => Response }).OPTIONS();
    check(
      `OPTIONS ${name} answers the preflight with CORS`,
      r.status === 204 && r.headers.get("access-control-allow-origin") === "*"
    );
  }

  // --- unknown query parameters are a 400 naming them -----------------------
  for (const [name, h, path] of [
    ["notifications", notificationsRoute.GET, "/notifications?bogus=1"],
    ["unread-count", unreadRoute.GET, "/notifications/unread-count?bogus=1"],
    ["search", searchRoute.GET, "/search?q=a&bogus=1"],
    ["favorites", favoritesRoute.GET, "/favorites?bogus=1"],
    ["capture-routes", captureRoutesRoute.GET, "/capture-routes?bogus=1"],
    ["items", itemsRoute.GET, "/items?bogus=1"],
  ] as const) {
    const r = await call(h as Handler, path);
    const b = await jsonOf(r);
    check(`${name}: unknown parameter is a 400 naming it`, r.status === 400 && /bogus/.test(b.error ?? ""));
  }

  // --- 1. items: inbox + updatedSince ---------------------------------------
  const inboxItem = await createItem(ownerId, {
    type: "note",
    title: `${stamp} inbox`,
    inbox: true,
  });
  createdItems.push(inboxItem.id);
  const filedItem = await createItem(ownerId, { type: "note", title: `${stamp} filed`, inbox: false });
  createdItems.push(filedItem.id);
  const ids = `${inboxItem.id},${filedItem.id}`;
  const inboxOn = await jsonOf(await call(itemsRoute.GET, `/items?id=${ids}&inbox=true`));
  check(
    "inbox=true returns only the untriaged item",
    inboxOn.items.length === 1 && inboxOn.items[0].id === inboxItem.id
  );
  const inboxOff = await jsonOf(await call(itemsRoute.GET, `/items?id=${ids}&inbox=false`));
  check(
    "inbox=false returns only the triaged item",
    inboxOff.items.length === 1 && inboxOff.items[0].id === filedItem.id
  );
  check("a non-boolean inbox is a 400", (await call(itemsRoute.GET, "/items?inbox=maybe")).status === 400);
  const before = new Date(new Date(inboxItem.updatedAt).getTime() - 1000).toISOString();
  const after = new Date(new Date(filedItem.updatedAt).getTime() + 1000).toISOString();
  const sinceBefore = await jsonOf(await call(itemsRoute.GET, `/items?id=${ids}&updatedSince=${encodeURIComponent(before)}`));
  check("updatedSince before the writes returns both", sinceBefore.items.length === 2);
  const sinceAfter = await jsonOf(await call(itemsRoute.GET, `/items?id=${ids}&updatedSince=${encodeURIComponent(after)}`));
  check("updatedSince after the writes returns none", sinceAfter.items.length === 0);
  check(
    "a non-ISO updatedSince is a 400",
    (await call(itemsRoute.GET, "/items?updatedSince=yesterday")).status === 400
  );

  // --- 2. items/[id]?include=relations, 3. DELETE relations -----------------
  const a = await createItem(ownerId, { type: "note", title: `${stamp} A` });
  const b = await createItem(ownerId, { type: "note", title: `${stamp} B` });
  const c = await createItem(ownerId, { type: "note", title: `${stamp} C` });
  createdItems.push(a.id, b.id, c.id);
  const link = await call(relationsRoute.POST, "/relations", {
    method: "POST",
    body: { relations: [{ sourceId: a.id, targetId: b.id, role: "related" }, { sourceId: a.id, targetId: c.id, role: "tag-ish" }] },
  });
  check("POST relations still works", link.status === 201);
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const withRel = await jsonOf(await call(itemRoute.GET, `/items/${a.id}?include=relations`, {}, ctx(a.id)));
  const relB = withRel.relations?.find((r: { id: string }) => r.id === b.id);
  check(
    "include=relations carries id/type/title/status/roles/matchState",
    !!relB && relB.type === "note" && relB.title === `${stamp} B` && Array.isArray(relB.roles) &&
      "status" in relB && "matchState" in relB && withRel.item?.id === a.id,
    JSON.stringify(relB)
  );
  const plainOne = await jsonOf(await call(itemRoute.GET, `/items/${a.id}`, {}, ctx(a.id)));
  check("without include the response has no relations key", !("relations" in plainOne));
  check(
    "include=bogus is a 400",
    (await call(itemRoute.GET, `/items/${a.id}?include=bogus`, {}, ctx(a.id))).status === 400
  );
  check(
    "other params on the per-item route are still rejected",
    (await call(itemRoute.GET, `/items/${a.id}?includeBody=true`, {}, ctx(a.id))).status === 400
  );

  const del1 = await call(relationsRoute.DELETE, "/relations", {
    method: "DELETE",
    body: { sourceId: a.id, targetId: b.id, role: "related" },
  });
  const del1b = await jsonOf(del1);
  check("DELETE one edge removes it", del1.status === 200 && del1b.removed[0]?.removed === 1, JSON.stringify(del1b));
  const delBatch = await jsonOf(
    await call(relationsRoute.DELETE, "/relations", {
      method: "DELETE",
      body: { relations: [{ sourceId: a.id, targetId: c.id, role: "tag-ish" }, { sourceId: "not-a-uuid", targetId: c.id }] },
    })
  );
  check(
    "DELETE batch: good edge removed, bad one reported in errors",
    delBatch.count === 1 && delBatch.errors.length === 1 && delBatch.errors[0].index === 1,
    JSON.stringify(delBatch)
  );
  check(
    "after the deletes the item has no related items",
    (await listRelatedItems(ownerId, a.id)).length === 0
  );
  check(
    "DELETE with a bad body is a 400",
    (await call(relationsRoute.DELETE, "/relations", { method: "DELETE", body: { sourceId: a.id } })).status === 400
  );

  // --- 4. notifications ------------------------------------------------------
  const unread0 = (await jsonOf(await call(unreadRoute.GET, "/notifications/unread-count"))).unread;
  check("unread-count returns a number", typeof unread0 === "number", JSON.stringify(await jsonOf(await call(unreadRoute.GET, "/notifications/unread-count"))));
  const [n1] = await db
    .insert(notifications)
    .values({ ownerId, kind: "verify-machine-phone", title: `${stamp} note`, state: "unread" })
    .returning({ id: notifications.id });
  createdNotifications.push(n1.id);
  const unread1 = (await jsonOf(await call(unreadRoute.GET, "/notifications/unread-count"))).unread;
  check("unread-count rises by one", unread1 === unread0 + 1, `${unread0} -> ${unread1}`);
  const listed = await jsonOf(await call(notificationsRoute.GET, "/notifications?filter=unread"));
  check(
    "GET ?filter=unread lists it, with counts",
    listed.notifications.some((n: { id: string }) => n.id === n1.id) && typeof listed.counts?.unread === "number"
  );
  check("a bad filter is a 400", (await call(notificationsRoute.GET, "/notifications?filter=nope")).status === 400);
  const patched = await jsonOf(
    await call(notificationsRoute.PATCH, "/notifications", { method: "PATCH", body: { ids: [n1.id], state: "read" } })
  );
  check("PATCH ids+state changes one row", patched.changed === 1 && typeof patched.counts?.unread === "number");
  const readList = await jsonOf(await call(notificationsRoute.GET, "/notifications?filter=read"));
  check("it now shows under filter=read", readList.notifications.some((n: { id: string }) => n.id === n1.id));
  check(
    "PATCH with no ids and no markAllRead is a 400",
    (await call(notificationsRoute.PATCH, "/notifications", { method: "PATCH", body: { state: "read" } })).status === 400
  );
  check(
    "PATCH with a bad state is a 400",
    (await call(notificationsRoute.PATCH, "/notifications", { method: "PATCH", body: { ids: [n1.id], state: "x" } })).status === 400
  );

  // --- 5. search -------------------------------------------------------------
  const found = await jsonOf(await call(searchRoute.GET, `/search?q=${stamp}&type=note&limit=10`));
  const hit = found.items.find((r: { id: string }) => r.id === a.id);
  check(
    "search finds a note by title word: id/type/title/snippet/updatedAt",
    !!hit && hit.type === "note" && "snippet" in hit && !!hit.updatedAt && !("body" in hit),
    String(found.items.length)
  );
  check("search without q is a 400", (await call(searchRoute.GET, "/search")).status === 400);
  check("search with a bad limit is a 400", (await call(searchRoute.GET, "/search?q=a&limit=999")).status === 400);
  const wrongType = await jsonOf(await call(searchRoute.GET, `/search?q=${stamp}&type=task`));
  check("search type filter narrows", wrongType.items.length === 0);

  // --- 6. favorites ----------------------------------------------------------
  const favOn = await jsonOf(await call(favoritesRoute.POST, "/favorites", { method: "POST", body: { itemId: a.id, favorite: true } }));
  check("POST favorite true stars it", favOn.favorited === true);
  const favList = await jsonOf(await call(favoritesRoute.GET, "/favorites"));
  check(
    "GET favorites lists it with id/title/type/icon",
    favList.items.some((f: { id: string; title: string; type: string; icon: unknown }) => f.id === a.id && f.type === "note" && "icon" in f)
  );
  const reorder = await call(favoritesRoute.PATCH, "/favorites", {
    method: "PATCH",
    body: { order: favList.items.map((f: { id: string }) => f.id) },
  });
  check("PATCH order is accepted", reorder.status === 200 && (await jsonOf(reorder)).ok === true);
  check("PATCH order with junk is a 400", (await call(favoritesRoute.PATCH, "/favorites", { method: "PATCH", body: { order: ["x"] } })).status === 400);
  check("POST favorite without a boolean is a 400", (await call(favoritesRoute.POST, "/favorites", { method: "POST", body: { itemId: a.id } })).status === 400);
  const favOff = await jsonOf(await call(favoritesRoute.POST, "/favorites", { method: "POST", body: { itemId: a.id, favorite: false } }));
  check("POST favorite false unstars it", favOff.favorited === false);

  // --- 7. types detail -------------------------------------------------------
  const types = await jsonOf(await call(typesRoute.GET, "/types"));
  const task = types.types.find((t: { key: string }) => t.key === "task");
  check(
    "types keep key/label/icon/isSystem/statusMode/capability",
    !!task && ["key", "label", "icon", "isSystem", "statusMode", "capability"].every((k) => k in task)
  );
  check(
    "types add statuses (key,label,category,color) and properties",
    !!task && Array.isArray(task.statuses) && task.statuses.length > 0 &&
      ["key", "label", "category", "color"].every((k) => k in task.statuses[0]) && Array.isArray(task.properties)
  );

  // --- 8. capture routes -----------------------------------------------------
  const routes = await jsonOf(await call(captureRoutesRoute.GET, "/capture-routes"));
  const quick = routes.routes?.find((r: { key: string }) => r.key === "quick_capture");
  check(
    "capture-routes lists each source with key/label/route",
    routes.routes.length >= 8 && !!quick && typeof quick.label === "string" && typeof quick.route === "string"
  );

  // --- 9. transcript attach --------------------------------------------------
  const meeting = await createItem(ownerId, { type: "event", title: `${stamp} meeting` });
  createdItems.push(meeting.id);
  const mctx = { params: Promise.resolve({ id: meeting.id }) };
  const tr = await call(
    transcriptsRoute.POST,
    `/meetings/${meeting.id}/transcripts`,
    { method: "POST", body: { title: `${stamp} transcript`, text: "Alice: hello\nBob: hi" } },
    mctx
  );
  const trBody = await jsonOf(tr);
  check("POST transcript is 201 with an id", tr.status === 201 && typeof trBody.id === "string", JSON.stringify(trBody));
  if (trBody.id) {
    createdItems.push(trBody.id);
    const row = await jsonOf(await call(itemRoute.GET, `/items/${trBody.id}`, {}, ctx(trBody.id)));
    check(
      "transcript item: type, parentId, properties.minutes=none, body text",
      row.item.type === "transcript" && row.item.parentId === meeting.id &&
        row.item.properties?.minutes === "none" && row.item.body?.text?.includes("Alice: hello")
    );
    const rel = await listRelatedItems(ownerId, meeting.id);
    check(
      "meeting -> transcript edge with role transcript exists",
      rel.some((r) => r.id === trBody.id && r.roles.includes("transcript"))
    );
  }
  const noText = await call(transcriptsRoute.POST, `/meetings/${meeting.id}/transcripts`, { method: "POST", body: { title: "x" } }, mctx);
  check("transcript without text is a 400", noText.status === 400);
  const notEvent = await call(
    transcriptsRoute.POST,
    `/meetings/${a.id}/transcripts`,
    { method: "POST", body: { text: "x" } },
    { params: Promise.resolve({ id: a.id }) }
  );
  check("transcript onto a non-event is a 400", notEvent.status === 400);
  const missing = "00000000-0000-4000-8000-000000000001";
  const nf = await call(
    transcriptsRoute.POST,
    `/meetings/${missing}/transcripts`,
    { method: "POST", body: { text: "x" } },
    { params: Promise.resolve({ id: missing }) }
  );
  check("transcript onto a missing meeting is a 404", nf.status === 404);
} finally {
  if (createdNotifications.length > 0) {
    await db.delete(notifications).where(inArray(notifications.id, createdNotifications));
  }
  // Put favorites back exactly as they were.
  await updateSettings(ownerId, { favorites: settingsBefore.favorites, modules: settingsBefore.modules });
  if (createdItems.length > 0) await db.delete(items).where(inArray(items.id, createdItems));
  await revokeCredential(ownerId, made.credential.id);
  await db.delete(apiCredentials).where(eq(apiCredentials.id, made.credential.id));
  console.log(
    `cleanup: removed ${createdItems.length} test items, ${createdNotifications.length} notifications and the test credential`
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
