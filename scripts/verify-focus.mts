// T3 verification (ADR-073): the daily focus layer. Pure marker helpers
// (focus.ts) + the focused-today query (getTodayData.focusTasks) against live
// Neon: only open tasks day-stamped for today appear; other days / done /
// other owners are excluded. Run: npx tsx scripts/verify-focus.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { parseFocus, isFocusedOn, focusOrder, FOCUS_SOFT_CAP } = await import("../src/lib/focus");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

console.log("\n# Pure: focus marker helpers");
check("parseFocus valid date", parseFocus({ date: "2026-06-17" })?.date === "2026-06-17");
check("parseFocus keeps order", parseFocus({ date: "2026-06-17", order: 5 })?.order === 5);
check("parseFocus bad date → null", parseFocus({ date: "nope" }) === null);
check("parseFocus null → null", parseFocus(null) === null);
check("isFocusedOn matches today", isFocusedOn({ focus: { date: "2026-06-17" } }, "2026-06-17"));
check("isFocusedOn rejects other day", !isFocusedOn({ focus: { date: "2026-06-16" } }, "2026-06-17"));
check("isFocusedOn no marker", !isFocusedOn({}, "2026-06-17"));
check("focusOrder reads order", focusOrder({ focus: { date: "2026-06-17", order: 3 } }) === 3);
check("focusOrder default is large", focusOrder({ focus: { date: "2026-06-17" } }) === Number.MAX_SAFE_INTEGER);
check("soft cap is 3", FOCUS_SOFT_CAP === 3);

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { createItem } = await import("../src/lib/item-mutations");
const { getTodayData } = await import("../src/lib/today");
const { eq: dEq, inArray } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-focus-${stamp}@example.invalid` })
  .returning({ id: users.id });
const [other] = await db
  .insert(users)
  .values({ email: `verify-focus-other-${stamp}@example.invalid` })
  .returning({ id: users.id });

try {
  // The app's notion of "today" (so the stamp matches the query).
  const { todayYmd } = await getTodayData(owner.id);
  const yesterday = (() => {
    const [y, m, d] = todayYmd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  })();

  console.log("\n# Service: focused-today query");
  const a = await createItem(owner.id, { type: "task", title: "focus today", properties: { focus: { date: todayYmd, order: 2 } } });
  const b = await createItem(owner.id, { type: "task", title: "focus today first", properties: { focus: { date: todayYmd, order: 1 } } });
  await createItem(owner.id, { type: "task", title: "focused yesterday", properties: { focus: { date: yesterday } } });
  await createItem(owner.id, { type: "task", title: "focus today but done", status: "done", properties: { focus: { date: todayYmd } } });
  await createItem(owner.id, { type: "task", title: "not focused" });
  // Another owner's focused-today task must not leak.
  await createItem(other.id, { type: "task", title: "other owner focus", properties: { focus: { date: todayYmd } } });

  const { focusTasks } = await getTodayData(owner.id);
  const ids = focusTasks.map((t) => t.id).sort();
  check("only the two open focused-today tasks return", JSON.stringify(ids) === JSON.stringify([a.id, b.id].sort()), `got ${focusTasks.length}`);
  check("done-today and other-day excluded", focusTasks.length === 2);
  // Order is applied by the page via focusOrder; verify the markers carry it.
  const ordered = [...focusTasks].sort((x, y) => focusOrder(x.properties) - focusOrder(y.properties));
  check("focus order sorts b (1) before a (2)", ordered[0].id === b.id);
} finally {
  for (const o of [owner.id, other.id]) {
    await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, o));
    await db.delete(items).where(dEq(items.ownerId, o));
  }
  await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
