// Slice 19 verification: captureError writes error_log rows the /health
// errors check can read, and the logger emits well-formed JSON lines.
// Runs against the live Neon DB; cleans its fixtures up after.
// Run with: npx tsx scripts/verify-logging.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const { sql } = await import("drizzle-orm");
const { getDb } = await import("../src/db");
const { captureError, createLogger, errorMessage, isDebugMode } = await import(
  "../src/lib/log"
);

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${got !== undefined ? `\n      got: ${JSON.stringify(got)}` : ""}`);
  }
}

const db = getDb();
const MARK = `verify-logging-${crypto.randomUUID().slice(0, 8)}`;

// --- logger line shape (captured via console hook) ---
{
  const lines: string[] = [];
  const orig = console.error;
  console.error = (s: string) => lines.push(s);
  const log = createLogger(MARK);
  log.error("boom", { extra: 1 });
  console.error = orig;
  const parsed = JSON.parse(lines[0]);
  check("logger emits one parseable JSON line", lines.length === 1);
  check(
    "line carries level/source/correlationId/message/fields",
    parsed.level === "error" &&
      parsed.source === MARK &&
      parsed.correlationId === log.correlationId &&
      parsed.message === "boom" &&
      parsed.extra === 1 &&
      typeof parsed.ts === "string",
    parsed
  );
}

// --- captureError → error_log row ---
{
  const correlationId = crypto.randomUUID();
  const orig = console.error;
  console.error = () => {};
  await captureError(MARK, new Error("synthetic failure"), { correlationId });
  console.error = orig;
  const res = await db.execute(sql`
    select source, message, detail, correlation_id from error_log
    where correlation_id = ${correlationId}
  `);
  const row = res.rows[0] as
    | { source: string; message: string; detail: { stack?: string } | null }
    | undefined;
  check("captureError inserted a row", !!row);
  check("row carries source + message", row?.source === MARK && row?.message === "synthetic failure", row);
  check("stack landed in detail jsonb", typeof row?.detail?.stack === "string", row?.detail);
}

// --- captureError with explicit message/detail (the export-cron shape) ---
{
  const correlationId = crypto.randomUUID();
  const orig = console.error;
  console.error = () => {};
  await captureError(MARK, null, {
    correlationId,
    message: "2 item(s) failed to export",
    detail: { itemErrors: [{ itemId: "a", message: "x" }] },
  });
  console.error = orig;
  const res = await db.execute(sql`
    select message, detail from error_log where correlation_id = ${correlationId}
  `);
  const row = res.rows[0] as { message: string; detail: { itemErrors?: unknown[] } } | undefined;
  check("explicit message wins", row?.message === "2 item(s) failed to export", row);
  check("explicit detail stored", Array.isArray(row?.detail?.itemErrors), row?.detail);
}

// --- the /health errors query shape (24h window, newest first) ---
{
  const res = await db.execute(sql`
    select source, message from error_log
    where created_at > now() - interval '24 hours' and source = ${MARK}
    order by created_at desc
  `);
  check("health window query finds both rows", res.rows.length === 2, res.rows.length);
}

// --- captureError never throws when the insert can't work ---
{
  const orig = console.error;
  const origWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let threw = false;
  try {
    // A detail jsonb that can't serialize forces the insert to fail.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await captureError(MARK, new Error("x"), { detail: cyclic });
  } catch {
    threw = true;
  }
  console.error = orig;
  console.warn = origWarn;
  check("captureError swallows insert failures", !threw);
}

// --- helpers ---
check("errorMessage on Error", errorMessage(new Error("e")) === "e");
check("errorMessage on non-Error", errorMessage("raw") === "raw");
check("isDebugMode reflects env", isDebugMode() === (process.env.DEBUG_MODE === "true"));

// --- cleanup ---
await db.execute(sql`delete from error_log where source = ${MARK}`);
const leftover = await db.execute(sql`select 1 from error_log where source = ${MARK}`);
check("fixtures cleaned up", leftover.rows.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
