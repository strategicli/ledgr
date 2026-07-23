// Placement layer verification (ADR-timeline): resolvePlacement + buildPatch
// across every storage shape — task day, task time-block, event instant + end,
// custom date prop + range, read-only anchor, and the rail clear. Pure, no DB.
// Run: npx tsx scripts/verify-placement.mts
import {
  resolvePlacement,
  buildPatch,
  endPropKey,
  type PlaceableItem,
  type PlacementSpec,
} from "../src/lib/placement";
import { ymdInZone, minutesInZone } from "../src/lib/zone";

const TZ = "America/New_York";
const asRec = (v: unknown): Record<string, unknown> => (v ?? {}) as Record<string, unknown>;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// A base item with everything empty; tests set the fields they care about.
function item(over: Partial<PlaceableItem>): PlaceableItem {
  return {
    type: "task",
    scheduledDate: null,
    dueDate: null,
    meetingAt: null,
    endAt: null,
    noteDate: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    properties: null,
    ...over,
  };
}

// --- task on a scheduled day (no time) → all-day chip, movable, not resizable
{
  const it = item({ scheduledDate: new Date("2026-07-23T00:00:00.000Z") });
  const spec: PlacementSpec = { start: { field: "plan" } };
  const p = resolvePlacement(it, spec, TZ);
  check("task day → start ymd", p.start?.ymd === "2026-07-23", p.start?.ymd);
  check("task day → all-day (minutes null)", p.start?.minutes === null);
  check("task day → no end (chip)", p.end === null);
  check("task day → movable, not resizable", p.can.move && !p.can.resizeStart && !p.can.resizeEnd);

  const body = buildPatch(it, spec, TZ, { start: { ymd: "2026-07-25", minutes: null }, end: null });
  check("task day move → scheduledDate UTC midnight", body.scheduledDate === "2026-07-25T00:00:00.000Z", String(body.scheduledDate));
  check("task day move → clears scheduledTime", asRec(body.propertyPatch).scheduledTime === null);
}

// --- task with a time block → bar within the day, resizable (writes duration)
{
  const it = item({
    scheduledDate: new Date("2026-07-23T00:00:00.000Z"),
    properties: { scheduledTime: { start: "14:00", durationMinutes: 90 } },
  });
  const spec: PlacementSpec = { start: { field: "scheduledDate" } };
  const p = resolvePlacement(it, spec, TZ);
  check("task block → start minutes = 840 (14:00)", p.start?.minutes === 840, String(p.start?.minutes));
  check("task block → end minutes = 930 (15:30)", p.end?.minutes === 930, String(p.end?.minutes));
  check("task block → resizable end", p.can.resizeEnd);

  // Resize the bottom edge to 16:00 (960) → duration 120.
  const body = buildPatch(it, spec, TZ, {
    start: { ymd: "2026-07-23", minutes: 840 },
    end: { ymd: "2026-07-23", minutes: 960 },
  });
  const st = asRec(asRec(body.propertyPatch).scheduledTime);
  check("task block resize → start kept 14:00", st?.start === "14:00", st?.start);
  check("task block resize → duration 120", st?.durationMinutes === 120, String(st?.durationMinutes));
}

// --- event: meeting_at + end_at instants, round-trip preserves time-of-day
{
  // 10:00 local on 2026-07-23 in America/New_York = 14:00Z (EDT, -4).
  const start = new Date("2026-07-23T14:00:00.000Z");
  const end = new Date("2026-07-23T15:30:00.000Z");
  const it = item({ type: "event", meetingAt: start, endAt: end });
  const spec: PlacementSpec = { start: { field: "meetingAt" }, end: { field: "endAt" } };
  const p = resolvePlacement(it, spec, TZ);
  check("event → local day 07-23", p.start?.ymd === "2026-07-23", p.start?.ymd);
  check("event → start 10:00 = 600 min", p.start?.minutes === 600, String(p.start?.minutes));
  check("event → end 11:30 = 690 min", p.end?.minutes === 690, String(p.end?.minutes));
  check("event → move + both resizes", p.can.move && p.can.resizeStart && p.can.resizeEnd);

  // Move the whole event to 09:00–10:30 on 07-24 → instants round-trip.
  const body = buildPatch(it, spec, TZ, {
    start: { ymd: "2026-07-24", minutes: 540 },
    end: { ymd: "2026-07-24", minutes: 630 },
  });
  const m = new Date(body.meetingAt as string);
  const e = new Date(body.endAt as string);
  check("event move → meetingAt back to 09:00 local", minutesInZone(m, TZ) === 540 && ymdInZone(m, TZ).d === 24, body.meetingAt as string);
  check("event move → endAt back to 10:30 local", minutesInZone(e, TZ) === 630, body.endAt as string);
}

// --- custom date property + range end (key + key__end)
{
  const it = item({
    type: "campaign",
    properties: { launch: "2026-07-20", [endPropKey("launch")]: "2026-07-28" },
  });
  const spec: PlacementSpec = { start: { prop: "launch" }, end: { prop: endPropKey("launch") } };
  const p = resolvePlacement(it, spec, TZ);
  check("prop range → start 07-20", p.start?.ymd === "2026-07-20", p.start?.ymd);
  check("prop range → end 07-28 (bar)", p.end?.ymd === "2026-07-28", p.end?.ymd);
  check("prop range → movable + resizable", p.can.move && p.can.resizeEnd);

  const body = buildPatch(it, spec, TZ, {
    start: { ymd: "2026-07-21", minutes: null },
    end: { ymd: "2026-07-30", minutes: null },
  });
  const pp = asRec(body.propertyPatch);
  check("prop range write → launch = 07-21", pp?.launch === "2026-07-21", pp?.launch);
  check("prop range write → launch__end = 07-30", pp?.["launch__end"] === "2026-07-30", pp?.["launch__end"]);
}

// --- backwards span (scheduled after due) → drops the end, renders a chip
{
  const it = item({
    scheduledDate: new Date("2026-07-25T00:00:00.000Z"),
    dueDate: new Date("2026-07-20T00:00:00.000Z"),
  });
  const spec: PlacementSpec = { start: { field: "scheduledDate" }, end: { field: "dueDate" } };
  const p = resolvePlacement(it, spec, TZ);
  check("backwards span → start kept", p.start?.ymd === "2026-07-25");
  check("backwards span → end dropped (chip)", p.end === null);
}

// --- read-only anchor (createdAt): shown, not movable/resizable
{
  const it = item({ createdAt: new Date("2026-07-23T18:00:00.000Z") });
  const spec: PlacementSpec = { start: { field: "createdAt" } };
  const p = resolvePlacement(it, spec, TZ);
  check("createdAt → placed", p.start?.ymd === "2026-07-23");
  check("createdAt → read-only (no move/resize)", !p.can.move && !p.can.resizeStart && !p.can.resizeEnd);
}

// --- no value in the start field → rail (start null)
{
  const it = item({});
  const p = resolvePlacement(it, { start: { field: "scheduledDate" } }, TZ);
  check("unscheduled → start null (rail)", p.start === null && p.end === null);
}

// --- rail clear: buildPatch with start null clears the field + block
{
  const it = item({ scheduledDate: new Date("2026-07-23T00:00:00.000Z") });
  const body = buildPatch(it, { start: { field: "scheduledDate" } }, TZ, { start: null, end: null });
  check("rail clear → scheduledDate null", body.scheduledDate === null);
  check("rail clear → scheduledTime null", asRec(body.propertyPatch).scheduledTime === null);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
