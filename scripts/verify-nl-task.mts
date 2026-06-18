// S4 verification (ADR-084): natural-language quick-add — parsing date +
// recurrence + urgency out of a task TITLE (parseTaskTitle in nl-date.ts). Pure
// only (no DB): the parser is deterministic given a reference "today". Run:
//   npx tsx scripts/verify-nl-task.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { parseTaskTitle } = await import("../src/lib/nl-date");

const TODAY = "2026-06-18"; // a Thursday
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, g === w ? "" : `got ${g}, want ${w}`);
}

console.log("\n# Dates (→ scheduled)");
{
  const r = parseTaskTitle("Call Bob tomorrow", TODAY);
  eq("tomorrow → scheduled +1", r.scheduledDate, "2026-06-19");
  eq("tomorrow → title stripped", r.title, "Call Bob");
}
{
  const r = parseTaskTitle("Plan offsite in 2 weeks", TODAY);
  eq("in 2 weeks → scheduled +14", r.scheduledDate, "2026-07-02");
  eq("in 2 weeks → title stripped", r.title, "Plan offsite");
}
{
  const r = parseTaskTitle("Review jun 20 budget", TODAY);
  eq("month-day → scheduled", r.scheduledDate, "2026-06-20");
  eq("month-day → title stripped (mid-string)", r.title, "Review budget");
}
{
  const r = parseTaskTitle("Renew license 6/30", TODAY);
  eq("slash date → scheduled", r.scheduledDate, "2026-06-30");
  eq("slash date → title stripped", r.title, "Renew license");
}
{
  const r = parseTaskTitle("Ship 2026-07-01", TODAY);
  eq("ISO date → scheduled", r.scheduledDate, "2026-07-01");
}
{
  const r = parseTaskTitle("Team review next week", TODAY);
  eq("next week → scheduled +7", r.scheduledDate, "2026-06-25");
  eq("next week → title stripped", r.title, "Team review");
}

console.log("\n# Due ('by <date>')");
{
  const r = parseTaskTitle("Submit report by friday", TODAY);
  eq("by friday → due (not scheduled)", r.dueDate, "2026-06-19");
  check("by friday → scheduled stays null", r.scheduledDate === null);
  eq("by friday → title stripped", r.title, "Submit report");
}

console.log("\n# Recurrence (→ RRULE)");
{
  const r = parseTaskTitle("Pay rent every month", TODAY);
  eq("every month → monthly rrule", r.recurrence?.rrule, "FREQ=MONTHLY");
  eq("every month → scheduled = first occurrence (today)", r.scheduledDate, "2026-06-18");
  eq("every month → title stripped", r.title, "Pay rent");
}
{
  const r = parseTaskTitle("Water plants every 3 days", TODAY);
  eq("every 3 days → daily interval 3", r.recurrence?.rrule, "FREQ=DAILY;INTERVAL=3");
  eq("every 3 days → title stripped", r.title, "Water plants");
}
{
  const r = parseTaskTitle("Team sync every monday", TODAY);
  eq("every monday → weekly BYDAY=MO", r.recurrence?.rrule, "FREQ=WEEKLY;BYDAY=MO");
  eq("every monday → scheduled = next Monday", r.scheduledDate, "2026-06-22");
  eq("every monday → dtstart anchors next Monday's enumeration at today", r.recurrence?.dtstart, "2026-06-18");
  eq("every monday → title stripped", r.title, "Team sync");
}
{
  const r = parseTaskTitle("Standup every weekday", TODAY);
  eq("every weekday → weekly Mon–Fri", r.recurrence?.rrule, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  eq("every weekday → scheduled = today (Thu is a weekday)", r.scheduledDate, "2026-06-18");
}
{
  const r = parseTaskTitle("daily journal", TODAY);
  eq("bare 'daily' → daily rrule", r.recurrence?.rrule, "FREQ=DAILY");
  eq("daily → title stripped", r.title, "journal");
}

console.log("\n# Urgency (p1..p4 / !1..!4)");
{
  eq("p1 → critical", parseTaskTitle("Fix outage p1", TODAY).urgency, "critical");
  eq("p2 → high", parseTaskTitle("Email p2", TODAY).urgency, "high");
  eq("p3 → normal", parseTaskTitle("Tidy p3", TODAY).urgency, "normal");
  eq("p4 → low", parseTaskTitle("Someday p4", TODAY).urgency, "low");
  eq("!1 → critical", parseTaskTitle("Ship !1", TODAY).urgency, "critical");
  eq("urgency strips from title", parseTaskTitle("Fix outage p1", TODAY).title, "Fix outage");
}

console.log("\n# Combined + detections");
{
  const r = parseTaskTitle("Submit report every weekday p2", TODAY);
  eq("combined: recurrence", r.recurrence?.rrule, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  eq("combined: urgency", r.urgency, "high");
  eq("combined: title clean", r.title, "Submit report");
  eq("combined: 2 detections (recurrence + urgency)", r.detections.length, 2);
  eq("combined: recurrence detection first", r.detections[0].field, "recurrence");
}

console.log("\n# No false positives");
{
  const r = parseTaskTitle("Plan the wedding", TODAY);
  check("'wedding' not read as Wednesday", r.scheduledDate === null && r.recurrence === null);
  eq("title untouched", r.title, "Plan the wedding");
  eq("no detections", r.detections.length, 0);
}
{
  const r = parseTaskTitle("Buy milk", TODAY);
  eq("plain title untouched", r.title, "Buy milk");
  check("plain title: nothing detected", r.detections.length === 0);
}
{
  // "p3" inside "mp3" must not match (word boundary).
  const r = parseTaskTitle("Convert mp3 files", TODAY);
  check("'mp3' not read as p3 urgency", r.urgency === null);
  eq("title untouched", r.title, "Convert mp3 files");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
