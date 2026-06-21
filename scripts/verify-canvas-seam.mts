// M5 / ADR-041 verification: the per-type canvas seam, as pure functions (no
// DB, no browser, no component imports — the policy half resolves the same here
// as on the server). The policy moved into the module registry in M6 (ADR-043),
// so `canvasIdForType`/`DEFAULT_CANVAS` now import from modules.ts; the M5
// invariants below are unchanged. (The fuller M6 contract is in
// verify-module-registry.mts.)
//  - modules.ts: canvasIdForType — `link` gets its own canvas; every other
//    type, and any unknown/module type, falls back to the default markdown
//    canvas.
//  - canvas-fields.ts: footerFieldsFor — the collapsed Fields section, with the
//    ADR-018 "task fields stay task-only" invariant.
//   npx tsx scripts/verify-canvas-seam.mts
import { footerFieldsFor } from "../src/lib/canvas-fields";
import { canvasIdForType, DEFAULT_CANVAS } from "../src/lib/modules";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- canvas resolution -----------------------------------------------------
check("the default canvas id is 'markdown'", DEFAULT_CANVAS === "markdown");
check("link resolves to its own canvas", canvasIdForType("link") === "link");
check("link is not the default", canvasIdForType("link") !== DEFAULT_CANVAS);
for (const t of ["note", "task", "event", "person"]) {
  check(`${t} falls back to the default canvas`, canvasIdForType(t) === DEFAULT_CANVAS);
}
check("an unregistered module type falls back to the default", canvasIdForType("song") === DEFAULT_CANVAS);
check("an empty type falls back to the default", canvasIdForType("") === DEFAULT_CANVAS);

// --- footer fields ---------------------------------------------------------
const t0 = new Date("2026-06-13T12:00:00Z");
const labels = (item: Parameters<typeof footerFieldsFor>[0]) =>
  footerFieldsFor(item).map((f) => f.label);

const note = {
  type: "note",
  dueDate: null,
  urgency: null,
  meetingAt: null,
  url: null,
  createdAt: t0,
  updatedAt: t0,
};
check(
  "a bare note shows only Type/Created/Updated",
  JSON.stringify(labels(note)) === JSON.stringify(["Type", "Created", "Updated"]),
  labels(note).join(",")
);

// ADR-018: due/urgency are task-only, even when legacy data sets them on
// another type — the canvas must not surface them.
const noteWithTaskFields = { ...note, dueDate: t0, urgency: "high" };
check(
  "a note with legacy due/urgency still hides them (ADR-018)",
  !labels(noteWithTaskFields).includes("Due") &&
    !labels(noteWithTaskFields).includes("Urgency"),
  labels(noteWithTaskFields).join(",")
);

// A task carries due/urgency in the top strip, so the footer doesn't repeat
// them — Type/Created/Updated only.
const task = { ...note, type: "task", dueDate: t0, urgency: "high" };
check(
  "a task's due/urgency live in the strip, not the footer",
  !labels(task).includes("Due") && !labels(task).includes("Urgency"),
  labels(task).join(",")
);

// A note carrying a URL (not in the note strip) surfaces it in the footer.
const noteWithUrl = { ...note, url: "https://example.com" };
check("a note's URL surfaces in the footer (not in its strip)", labels(noteWithUrl).includes("URL"));

// link keeps its distinguishing field in the strip, not the footer.
const link = { ...note, type: "link", url: "https://example.com" };
check("a link's URL lives in the strip, not the footer", !labels(link).includes("URL"), labels(link).join(","));

check(
  "Type is always first, Created/Updated always last",
  labels(note)[0] === "Type" && labels(note).slice(-2).join(",") === "Created,Updated"
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
