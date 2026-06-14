// SPIKE verification (bespoke-tool catalog, next_steps.md:94): the decoupling of
// a module's *behavior* from a fixed type key. Pure functions, no DB/browser —
// this file running in plain node IS the proof that the capability resolution
// stays in the pure registry half. It exercises:
//
//  1. Workflow modules expose attachable capabilities (Chord Chart, Paper).
//  2. A user-named type that borrows a capability resolves that module's canvas,
//     canonical format, and exporters — re-pointed at the user's own key.
//  3. A real module type still wins over a passed capability (no regression).
//  4. No capability / unknown capability falls back to the default canvas.
//  5. parseTypeInput validates the capability against the live registry.
//
//   npx tsx scripts/verify-bespoke-capability.mts
import { CHORDPRO_FORMAT } from "../src/lib/chordpro/types";
import { MARKDOWN_FORMAT } from "../src/lib/body";
import {
  DEFAULT_CANVAS,
  attachableCapabilities,
  canonicalFormatForType,
  canvasIdForType,
  capabilityById,
  exportersForType,
} from "../src/lib/modules";
// Registers Songs + Papers onto core for their side effect (the canvas path does
// this via module-wiring; here we do it directly).
import "../src/lib/modules/register";
import { parseTypeInput } from "../src/lib/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- 1. capabilities are exposed for attachment ----------------------------
const caps = attachableCapabilities();
check("chord-chart capability is offered", caps.some((c) => c.id === "chord-chart"));
check("paper-workspace capability is offered", caps.some((c) => c.id === "paper-workspace"));
check("a capability carries catalog copy", !!capabilityById("chord-chart")?.usage);
check("chord-chart is owned by the songs module", capabilityById("chord-chart")?.moduleId === "songs");
check("an unknown capability id resolves to undefined", capabilityById("nope") === undefined);

// --- 2. a user-named type borrows the behavior -----------------------------
// "worship_set" is NOT a registered module type — it's a type a user would make.
check(
  "a borrowed capability supplies the canvas",
  canvasIdForType("worship_set", undefined, "chord-chart") === "chord"
);
check(
  "a borrowed capability supplies the canonical format",
  canonicalFormatForType("worship_set", undefined, "chord-chart") === CHORDPRO_FORMAT
);
const borrowed = exportersForType("worship_set", undefined, "chord-chart");
check("a borrowed capability supplies the module's exporters", borrowed.length === 1);
check(
  "the borrowed exporter is re-pointed at the user's type key",
  borrowed[0]?.forType === "worship_set"
);
check(
  "the paper workspace can be borrowed too",
  canvasIdForType("article", undefined, "paper-workspace") === "paper"
);

// --- 3. a real module type still wins over a passed capability -------------
check(
  "a registered module type ignores a passed capability",
  canvasIdForType("song", undefined, "paper-workspace") === "chord"
);
check(
  "song still resolves its own canvas with no capability",
  canvasIdForType("song") === "chord"
);

// --- 4. fallback when nothing applies --------------------------------------
check(
  "a user type with no capability falls back to the default canvas",
  canvasIdForType("worship_set") === DEFAULT_CANVAS
);
check(
  "a user type with no capability is markdown-canonical",
  canonicalFormatForType("worship_set") === MARKDOWN_FORMAT
);
check(
  "an unknown capability id falls back to the default canvas",
  canvasIdForType("worship_set", undefined, "nope") === DEFAULT_CANVAS
);

// --- 5. input validation ----------------------------------------------------
const ok = parseTypeInput(
  { key: "worship_set", label: "Worship Set", capability: "chord-chart" },
  "create"
);
check("parseTypeInput accepts a known capability", ok.capability === "chord-chart");
const none = parseTypeInput({ key: "plain", label: "Plain" }, "create");
check("parseTypeInput defaults a missing capability to null", none.capability === null);
let threw = false;
try {
  parseTypeInput({ key: "bad", label: "Bad", capability: "made-up" }, "create");
} catch {
  threw = true;
}
check("parseTypeInput rejects an unknown capability", threw);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
