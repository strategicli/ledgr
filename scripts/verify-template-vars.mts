// Pure unit checks for the template variable resolver (ADR-093, TPL3). No DB —
// the resolver is pure (the caller passes today/now). Run: npx tsx scripts/verify-template-vars.mts
import { resolveVars, scanAskLabels, hasVars, type VarContext } from "../src/lib/template-vars";

let pass = 0;
let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`}`);
}
function truthy(label: string, cond: boolean) {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

// 2026-06-20 is a Saturday.
const ctx: VarContext = {
  todayYmd: "2026-06-20",
  now: new Date("2026-06-20T18:30:00Z"),
  timeZone: "UTC",
  title: "My Title",
  answers: { Topic: "Prayer", "Due owner": "Sam" },
};
const r = (t: string, c: VarContext = ctx) => resolveVars(t, c);

// dates + formats
eq("today default", r("{{today}}"), "Jun 20, 2026");
eq("today:iso", r("{{today:iso}}"), "2026-06-20");
eq("today:long", r("{{today:long}}"), "June 20, 2026");
eq("today:short", r("{{today:short}}"), "Jun 20");
eq("today:us", r("{{today:us}}"), "6/20/2026");
eq("today:day (Saturday)", r("{{today:day}}"), "Saturday");
eq("tomorrow:iso", r("{{tomorrow:iso}}"), "2026-06-21");
eq("yesterday:iso", r("{{yesterday:iso}}"), "2026-06-19");

// offsets
eq("today+7d", r("{{today+7d:iso}}"), "2026-06-27");
eq("today-3d", r("{{today-3d:iso}}"), "2026-06-17");
eq("today+2w", r("{{today+2w:iso}}"), "2026-07-04");
eq("today+1m", r("{{today+1m:iso}}"), "2026-07-20");
eq("today+1y", r("{{today+1y:iso}}"), "2027-06-20");

// weekdays (Sat 6/20 → next Sun = 6/28; this coming Sun = 6/21)
eq("nextSunday:iso", r("{{nextSunday:iso}}"), "2026-06-28");
eq("sunday:iso (this coming)", r("{{sunday:iso}}"), "2026-06-21");

// title + ask
eq("title echo", r("{{title}}"), "My Title");
eq("ask answered", r("{{ask:Topic}}"), "Prayer");
eq("ask label with space", r("{{ask:Due owner}}"), "Sam");
eq("ask unanswered → empty", r("{{ask:Missing}}"), "");

// robustness
eq("unknown token left intact", r("{{bogus}}"), "{{bogus}}");
eq("whitespace inside braces", r("{{ today }}"), "Jun 20, 2026");
eq("case-insensitive base", r("{{TODAY:iso}}"), "2026-06-20");
eq(
  "mixed line",
  r("Sermon for {{nextSunday:long}} on {{ask:Topic}}"),
  "Sermon for June 28, 2026 on Prayer"
);
eq("invalid today → text unchanged", resolveVars("{{today}}", { todayYmd: "nope" }), "{{today}}");

// now (UTC vs tz)
eq("now:time UTC", r("{{now:time}}"), "6:30 PM");
eq("now default UTC", r("{{now}}"), "Jun 20, 2026, 6:30 PM");
eq(
  "now:time in America/New_York (EDT = UTC-4)",
  r("{{now:time}}", { ...ctx, timeZone: "America/New_York" }),
  "2:30 PM"
);
eq("now without an instant → date only", r("{{now}}", { todayYmd: "2026-06-20" }), "Jun 20, 2026");

// scan + hasVars
eq(
  "scanAskLabels distinct + ordered",
  scanAskLabels(["{{ask:Topic}} {{ask:Due owner}}", "{{ask:Topic}} again", null, undefined]),
  ["Topic", "Due owner"]
);
truthy("hasVars date token", hasVars("a {{today}} b"));
truthy("hasVars ask token", hasVars("{{ask:X}}"));
truthy("hasVars false for plain text", !hasVars("nothing here"));
truthy("hasVars false for unknown token", !hasVars("{{bogus}}"));

console.log(`\n${fail ? "FAIL" : "ALL PASS"} (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
