// PJ10 / ADR-111 verification: universal per-type homepages. The widget-composed
// homepage is a capability ANY type can adopt in Build (the existing ADR-051
// capability seam) — Project/Pursuit are just the first adopters. This proves the
// acceptance criterion "adding a brand-new Type requires ZERO widget authoring":
// attach widget-home to an arbitrary type and it routes to the widget canvas,
// inherits the whole catalog, and gets a default composition — no per-type code.
// Run: npx tsx scripts/verify-type-homepage.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getDb } = await import("../src/db");
const { types, users } = await import("../src/db/schema");
const { attachableCapabilities, capabilityById, canvasIdForType } = await import("../src/lib/modules");
const { availableWidgets, WIDGET_CATALOG } = await import("../src/lib/widgets");
const { resolveComposition } = await import("../src/lib/composition");
const { eq } = await import("drizzle-orm");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const db = getDb();
const ownerId = (await db.select({ id: users.id }).from(users))[0].id;

console.log("\n# widget-home is the default homepage for custom types, no longer a pickable tool (2026-07-01)");
{
  const caps = attachableCapabilities(ownerId).map((c) => c.id);
  check("Build no longer offers 'widget-home' as a pickable bespoke tool", !caps.includes("widget-home"), caps.join(","));
  check("but the widget-home capability still RESOLVES for types that carry it", capabilityById("widget-home", ownerId)?.canvasId === "widgets");
}

console.log("\n# an arbitrary type adopts the homepage with ZERO widget authoring");
const TEST_KEY = "pj10_homepage_test";
{
  await db.delete(types).where(eq(types.key, TEST_KEY)); // idempotent
  await db.insert(types).values({ key: TEST_KEY, label: "PJ10 Test", capability: "widget-home" });

  check("the type routes to the widget canvas", canvasIdForType(TEST_KEY, ownerId, "widget-home") === "widgets");
  check("it inherits the WHOLE widget catalog (zero authoring)", availableWidgets(TEST_KEY).length === WIDGET_CATALOG.length, `${availableWidgets(TEST_KEY).length}/${WIDGET_CATALOG.length}`);

  // No Layer-2 default authored → the generated generic homepage (body + status).
  const { composition, source } = resolveComposition(null, null, TEST_KEY);
  const defIds = composition.widgets.map((w) => w.defId);
  check("it gets a generated default composition", source === "generated" && defIds.includes("overview") && defIds.includes("status"), defIds.join(","));

  // A type CAN author a Layer-2 default (default_widgets) that then wins.
  const authored = { version: 1, widgets: [{ instanceId: "tasks", defId: "tasks" }], behaviors: {} };
  const r2 = resolveComposition(null, authored, TEST_KEY);
  check("an authored type default (Layer 2) is honored over the generated one", r2.source === "type" && r2.composition.widgets[0].defId === "tasks");

  await db.delete(types).where(eq(types.key, TEST_KEY));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
