// S5 verification (ADR-085): relative subtask scheduling. Two halves:
//   1. PURE (relative-subtask.ts) — parse, offsetBetween, applyOffset, describe.
//   2. SERVICE (live Neon) — recompute on a parent scheduled-date change (incl.
//      chaining + clearing when the anchor is removed), an absolute subtask left
//      untouched, and the clone/materialize path deriving a relative child's date.
// Run: npx tsx scripts/verify-relative-subtasks.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { parseRelativeSchedule, relativeOffsetOf, offsetBetween, applyOffset, describeOffset } =
  await import("../src/lib/relative-subtask");
const { dateToYmdUtc } = await import("../src/lib/recurrence");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, g === w ? "" : `got ${g}, want ${w}`);
}

console.log("\n# Pure");
eq("parse valid", parseRelativeSchedule({ offsetDays: 2 }), { offsetDays: 2 });
check("parse non-integer → null", parseRelativeSchedule({ offsetDays: 2.5 }) === null);
check("parse missing → null", parseRelativeSchedule({}) === null);
check("parse null → null", parseRelativeSchedule(null) === null);
eq("relativeOffsetOf reads offset", relativeOffsetOf({ relativeSchedule: { offsetDays: -1 } }), -1);
check("relativeOffsetOf without → null", relativeOffsetOf({ foo: 1 }) === null);
eq("offsetBetween +2", offsetBetween("2026-06-18", "2026-06-20"), 2);
eq("offsetBetween -1", offsetBetween("2026-06-18", "2026-06-17"), -1);
eq("offsetBetween 0", offsetBetween("2026-06-18", "2026-06-18"), 0);
eq("applyOffset +2", applyOffset("2026-06-18", 2), "2026-06-20");
eq("applyOffset -1", applyOffset("2026-06-18", -1), "2026-06-17");
eq("applyOffset across month", applyOffset("2026-06-30", 3), "2026-07-03");
eq("describe same day", describeOffset(0), "same day");
eq("describe +2", describeOffset(2), "+2d");
eq("describe -1", describeOffset(-1), "−1d");

// ---------------------------------------------------------------------------
const { getDb } = await import("../src/db");
const { items, users } = await import("../src/db/schema");
const { getItem } = await import("../src/lib/items");
const {
  createItem,
  updateItem,
} = await import("../src/lib/item-mutations");
const { cloneItemSubtree } = await import("../src/lib/clone");
const { eq: dEq, inArray } = await import("drizzle-orm");

const db = getDb();
const stamp = Date.now();
const [owner] = await db
  .insert(users)
  .values({ email: `verify-relsub-${stamp}@example.invalid` })
  .returning({ id: users.id });

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const sched = (i: { scheduledDate: Date | null }) =>
  i.scheduledDate ? dateToYmdUtc(i.scheduledDate) : null;

try {
  console.log("\n# Service: recompute on parent scheduled-date change");
  {
    const parent = await createItem(owner.id, {
      type: "task",
      title: "Plan event",
      scheduledDate: ymdToUtc("2026-06-18"),
    });
    const rel = await createItem(owner.id, {
      type: "task",
      title: "Send invites (+2d)",
      parentId: parent.id,
      scheduledDate: ymdToUtc("2026-06-20"),
      properties: { relativeSchedule: { offsetDays: 2 } },
    });
    const abs = await createItem(owner.id, {
      type: "task",
      title: "Fixed prep",
      parentId: parent.id,
      scheduledDate: ymdToUtc("2026-06-19"),
    });

    // Move the parent +7 days → the relative child shifts, the absolute one doesn't.
    await updateItem(owner.id, parent.id, { scheduledDate: ymdToUtc("2026-06-25") });
    eq("relative child shifts with parent", sched(await getItem(owner.id, rel.id)), "2026-06-27");
    eq("absolute child untouched", sched(await getItem(owner.id, abs.id)), "2026-06-19");

    // Remove the parent's date → the relative child clears (no anchor).
    await updateItem(owner.id, parent.id, { scheduledDate: null });
    check("relative child clears when parent loses its date", sched(await getItem(owner.id, rel.id)) === null);

    // Restore the parent's date → the relative child re-derives (offset kept).
    await updateItem(owner.id, parent.id, { scheduledDate: ymdToUtc("2026-07-01") });
    eq("relative child re-derives when parent re-dated", sched(await getItem(owner.id, rel.id)), "2026-07-03");
    const relItem = await getItem(owner.id, rel.id);
    eq("offset preserved across clear/restore", relativeOffsetOf(relItem.properties as Record<string, unknown>), 2);
  }

  console.log("\n# Service: offsets chain down the tree");
  {
    const parent = await createItem(owner.id, {
      type: "task", title: "Launch", scheduledDate: ymdToUtc("2026-06-18"),
    });
    const child = await createItem(owner.id, {
      type: "task", title: "Draft (+2d)", parentId: parent.id,
      scheduledDate: ymdToUtc("2026-06-20"), properties: { relativeSchedule: { offsetDays: 2 } },
    });
    const grand = await createItem(owner.id, {
      type: "task", title: "Review (+1d from draft)", parentId: child.id,
      scheduledDate: ymdToUtc("2026-06-21"), properties: { relativeSchedule: { offsetDays: 1 } },
    });
    await updateItem(owner.id, parent.id, { scheduledDate: ymdToUtc("2026-06-25") });
    eq("child re-derives (25+2)", sched(await getItem(owner.id, child.id)), "2026-06-27");
    eq("grandchild chains (27+1)", sched(await getItem(owner.id, grand.id)), "2026-06-28");
  }

  console.log("\n# Service: clone/materialize derives a relative child's date");
  {
    const proto = await createItem(owner.id, { type: "task", title: "Weekly ritual" });
    await createItem(owner.id, {
      type: "task", title: "Prep (+3d)", parentId: proto.id,
      properties: { relativeSchedule: { offsetDays: 3 } },
    });
    await createItem(owner.id, { type: "task", title: "Plain step", parentId: proto.id });

    const { rootId } = await cloneItemSubtree(owner.id, proto.id, {
      scheduledDate: ymdToUtc("2026-07-10"),
    });
    const cloneRoot = await getItem(owner.id, rootId);
    eq("clone root takes the occurrence date", sched(cloneRoot), "2026-07-10");
    const kids = await db
      .select({ id: items.id, title: items.title, scheduledDate: items.scheduledDate })
      .from(items)
      .where(dEq(items.parentId, rootId));
    const prep = kids.find((k) => k.title.startsWith("Prep"));
    const plain = kids.find((k) => k.title.startsWith("Plain"));
    eq("relative clone child derives (10+3)", prep && sched(prep), "2026-07-13");
    check("plain clone child has no date", !!plain && plain.scheduledDate === null);
  }
} finally {
  await db.update(items).set({ parentId: null }).where(dEq(items.ownerId, owner.id));
  await db.delete(items).where(dEq(items.ownerId, owner.id));
  await db.delete(users).where(inArray(users.id, [owner.id]));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
