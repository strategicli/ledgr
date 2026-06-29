// Planner (ADR-131) verification — Phase 1 data foundation: the views.display
// jsonb config and its tolerant parser, plus a round-trip through the
// owner-scoped view store to prove the new column persists and reads back.
// Against live Neon under a throwaway owner. Run: npx tsx scripts/verify-planner.mts
// The drag-write / slot-math assertions land with the interactive slice.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { getDb } = await import("../src/db");
const { items, views, users } = await import("../src/db/schema");
const { parseDisplay, parseViewInput, createView, getView, DISPLAY_DEFAULTS } =
  await import("../src/lib/views");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- parseDisplay: tolerant, clamping, never throws ---
check("null → null (falls back to defaults)", parseDisplay(null) === null);
check("non-object → null", parseDisplay(42) === null && parseDisplay([1]) === null);
check("empty object → null", parseDisplay({}) === null);
check("drops unknown keys → null", parseDisplay({ bogus: 1 }) === null);

const full = parseDisplay({
  mode: "timegrid",
  dayCount: 5,
  slotMinutes: 15,
  placeBy: "due",
  workStartHour: 6,
  workEndHour: 20,
  showWeekends: false,
});
check("keeps a full valid config", JSON.stringify(full) === JSON.stringify({
  mode: "timegrid", dayCount: 5, slotMinutes: 15, placeBy: "due",
  workStartHour: 6, workEndHour: 20, showWeekends: false,
}));

check("drops invalid mode", parseDisplay({ mode: "spiral" }) === null);
check("clamps dayCount high", parseDisplay({ dayCount: 99 })?.dayCount === 7);
check("clamps dayCount low", parseDisplay({ dayCount: 0 })?.dayCount === 1);
check("rounds dayCount", parseDisplay({ dayCount: 3.7 })?.dayCount === 4);
check("rejects off-grid slotMinutes", parseDisplay({ slotMinutes: 20 }) === null);
check("accepts 30 slotMinutes", parseDisplay({ slotMinutes: 30 })?.slotMinutes === 30);
check("drops invalid placeBy", parseDisplay({ placeBy: "whenever" }) === null);
check("clamps workStartHour", parseDisplay({ workStartHour: 30 })?.workStartHour === 23);
check(
  "drops inverted window end (keeps start)",
  (() => { const d = parseDisplay({ workStartHour: 18, workEndHour: 9 }); return d?.workStartHour === 18 && d?.workEndHour === undefined; })()
);
check("showWeekends boolean only", parseDisplay({ showWeekends: "yes" }) === null);

check("defaults are sane", DISPLAY_DEFAULTS.mode === "month" && DISPLAY_DEFAULTS.placeBy === "scheduled" && DISPLAY_DEFAULTS.dayCount === 7);

// --- parseViewInput threads display ---
check(
  "parseViewInput keeps a valid display",
  parseViewInput({ name: "Planner", layout: "calendar", display: { mode: "timegrid", placeBy: "due" } }).display?.mode === "timegrid"
);
check(
  "parseViewInput display null when absent",
  parseViewInput({ name: "Cal", layout: "calendar" }).display === null
);

// --- round-trip through the owner-scoped store (the new column) ---
const db = getDb();
const [tempUser] = await db
  .insert(users)
  .values({ email: `verify-planner-${Date.now()}@example.invalid` })
  .returning({ id: users.id });
const ownerId = tempUser.id;
try {
  const created = await createView(
    ownerId,
    parseViewInput({
      name: "My Planner",
      layout: "calendar",
      dateProperty: "scheduledDate",
      display: { mode: "timegrid", dayCount: 3, slotMinutes: 15, placeBy: "scheduled" },
    })
  );
  check("created view stores display", created.display?.mode === "timegrid" && created.display?.dayCount === 3);
  const fetched = await getView(ownerId, created.id);
  check("display reads back from the column", fetched.display?.slotMinutes === 15 && fetched.display?.placeBy === "scheduled");

  const plain = await createView(ownerId, parseViewInput({ name: "Plain list", layout: "list" }));
  check("non-calendar view leaves display null", plain.display === null);
} finally {
  await db.delete(views).where(eq(views.ownerId, ownerId));
  await db.delete(items).where(eq(items.ownerId, ownerId));
  await db.delete(users).where(eq(users.id, ownerId));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
