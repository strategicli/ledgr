// Timeline geometry verification (ADR-166): date↔x round-trips and ruler ticks
// across zooms. Pure, no DB. Run: npx tsx scripts/verify-timeline-geometry.mts
import {
  pxPerDay,
  daysBetween,
  dateToX,
  xToDate,
  addDays,
  snapMinutes,
  ticks,
} from "../src/lib/timeline-geometry";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const O = "2026-07-20"; // a Monday

check("daysBetween forward", daysBetween(O, "2026-07-27") === 7);
check("daysBetween backward", daysBetween(O, "2026-07-18") === -2);
check("daysBetween across month", daysBetween("2026-07-30", "2026-08-02") === 3);
check("addDays wraps month", addDays("2026-07-30", 3) === "2026-08-02", addDays("2026-07-30", 3));
check("addDays negative", addDays(O, -1) === "2026-07-19", addDays(O, -1));

// day-only chip at week zoom sits at day boundary
check(
  "dateToX day-only = dayIndex * ppd",
  dateToX("2026-07-27", null, O, "week") === 7 * pxPerDay("week"),
);

// timed anchor adds intraday fraction (12:00 = half a day)
{
  const ppd = pxPerDay("day");
  check("dateToX timed noon = 0.5 day", dateToX(O, 720, O, "day") === 0.5 * ppd, String(dateToX(O, 720, O, "day")));
}

// round-trip at hour zoom snaps to 15 min
{
  const x = dateToX("2026-07-21", 615, O, "hour"); // 10:15 next day
  const back = xToDate(x, O, "hour");
  check("hour round-trip ymd", back.ymd === "2026-07-21", back.ymd);
  check("hour round-trip minutes (snap 15)", back.minutes === 615, String(back.minutes));
  check("hour snap = 15", snapMinutes("hour") === 15);
}

// coarse zoom → day-only (minutes null)
{
  const x = dateToX("2026-08-01", null, O, "month");
  const back = xToDate(x + 5, O, "month"); // a few px into the day still resolves that day
  check("month zoom resolves day", back.ymd === "2026-08-01", back.ymd);
  check("month zoom minutes null", back.minutes === null);
  check("month snap null", snapMinutes("month") === null);
}

// ticks: week zoom yields one per day, major on Mondays, spanning the range
{
  const t = ticks(O, 14, "week");
  check("week ticks count = 14", t.length === 14, String(t.length));
  check("week tick 0 is major (Monday)", t[0].major === true);
  check("week tick 1 not major (Tuesday)", t[1].major === false);
  check("week tick 7 major (next Monday)", t[7].major === true);
  check("week first tick x = 0", t[0].x === 0);
}

// ticks: hour zoom yields intraday ticks, major at midnight
{
  const t = ticks(O, 1, "hour");
  check("hour ticks = 24 in a day", t.length === 24, String(t.length));
  check("hour tick 0 major (midnight)", t[0].major === true);
  check("hour tick 1 not major", t[1].major === false);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
