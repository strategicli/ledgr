// M6 / ADR-043 verification: the module-registration boundary, as pure functions
// (no DB, no browser, no component imports — this file running in plain node IS
// the proof that the policy/contract half stays pure). It exercises the full
// contract a module contributes — {type, canvas, exporters, integration} — plus
// the per-user enable seam.
//
//  1. Core dogfoods the boundary: the five system types resolve through it,
//     `link` keeps its bespoke canvas, everything else is the default.
//  2. A workflow module slots in (register the reference example): its type,
//     canvas, canonical format, exporter (which runs deterministically), and
//     integration all resolve.
//  3. Canonical-body-format-per-type is real (a ChordPro-style fixture).
//  4. The enable seam: a disabled module's type falls back to the default
//     canvas, contributes no exporters, and reports no format override.
//  5. Boundary hygiene: duplicate module ids are rejected.
//
//   npx tsx scripts/verify-module-registry.mts
import { MARKDOWN_FORMAT } from "../src/lib/body";
import {
  DEFAULT_CANVAS,
  allModules,
  canonicalFormatForType,
  canvasIdForType,
  coreModule,
  exportersForType,
  isModuleEnabled,
  moduleForType,
  referenceModule,
  registerModule,
  registeredTypeKeys,
  typeDefFor,
  type CanvasItem,
  type ModuleManifest,
} from "../src/lib/modules";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- 1. core dogfoods the boundary -----------------------------------------
check("core is a registered, enabled module", isModuleEnabled("core") === true);
check("core owns the system types", moduleForType("task")?.id === "core");
for (const t of ["event", "note", "person"]) {
  check(`${t} resolves to the default canvas`, canvasIdForType(t) === DEFAULT_CANVAS);
  check(`${t} is markdown-canonical`, canonicalFormatForType(t) === MARKDOWN_FORMAT);
}
check("task keeps its bespoke canvas (ADR-108)", canvasIdForType("task") === "task");
check("link keeps its bespoke canvas (ADR-041)", canvasIdForType("link") === "link");
check("core contributes no per-type exporters", exportersForType("task").length === 0);
check(
  "every core type key is registered",
  ["task", "event", "note", "link", "person"].every((k) =>
    registeredTypeKeys().includes(k)
  )
);
check("an unknown type falls back to the default canvas", canvasIdForType("nope") === DEFAULT_CANVAS);
check("an unknown type has no owning module", moduleForType("nope") === undefined);

// --- 2. a workflow module slots in -----------------------------------------
// Before registration the reference type is unknown — proves the resolvers
// aren't secretly hardcoding it.
check("reference type is unknown before registration", moduleForType("reference") === undefined);
check("reference canvas is the default before registration", canvasIdForType("reference") === DEFAULT_CANVAS);

registerModule(referenceModule);

check("reference module is registered + enabled", isModuleEnabled("reference") === true);
check("reference module appears in allModules()", allModules().some((m) => m.id === "reference"));
check("reference type is now owned by the reference module", moduleForType("reference")?.id === "reference");
// Canvas slot — a module declares its own, non-default canvas.
check("reference declares its own canvas", canvasIdForType("reference") === "reference-canvas");
check("reference canvas is not the default", canvasIdForType("reference") !== DEFAULT_CANVAS);
// Format slot.
check("reference type is markdown-canonical", canonicalFormatForType("reference") === MARKDOWN_FORMAT);
// Exporter slot — present, correctly shaped, and deterministic.
const refExporters = exportersForType("reference");
check("reference contributes exactly one exporter", refExporters.length === 1, `${refExporters.length}`);
const exp = refExporters[0];
check("exporter is shaped correctly", !!exp && exp.id === "reference-text" && exp.forType === "reference" && exp.fileExtension === "txt");
const rendered = await Promise.resolve(
  exp.render({ format: MARKDOWN_FORMAT, text: "quote bank → draft" }, {} as unknown as CanvasItem)
);
check("exporter render is deterministic, no model", rendered === "quote bank → draft");
// Integration slot.
check("reference declares a pull integration", referenceModule.integration?.direction === "pull");
check("reference type key is enumerated", registeredTypeKeys().includes("reference"));

// --- 3. canonical body format is a property of the type (Tyler PR #1 #1) ----
const songFixture: ModuleManifest = {
  id: "song-fixture",
  label: "Song fixture",
  enabledByDefault: true,
  types: [
    { key: "song-fixture-type", label: "Song", canonicalFormat: "chordpro", canvasId: "chord-canvas" },
  ],
  exporters: [],
};
registerModule(songFixture);
check("a non-markdown canonical format resolves", canonicalFormatForType("song-fixture-type") === "chordpro");
check("the song fixture declares its chord canvas", canvasIdForType("song-fixture-type") === "chord-canvas");

// --- 4. the per-user enable seam (the later flip) --------------------------
const disabledFixture: ModuleManifest = {
  id: "disabled-fixture",
  label: "Disabled fixture",
  enabledByDefault: false,
  types: [
    { key: "disabled-type", label: "Disabled", canonicalFormat: "chordpro", canvasId: "disabled-canvas" },
  ],
  exporters: [
    { id: "disabled-export", label: "x", forType: "disabled-type", fileExtension: "txt", render: (b) => b.text },
  ],
  integration: { id: "disabled-int", label: "x", direction: "push" },
};
registerModule(disabledFixture);
check("a disabled module reports disabled", isModuleEnabled("disabled-fixture") === false);
check("a disabled module's type has no owner", moduleForType("disabled-type") === undefined);
check("a disabled module's type has no type def", typeDefFor("disabled-type") === undefined);
check("a disabled module's type falls back to the default canvas", canvasIdForType("disabled-type") === DEFAULT_CANVAS);
check("a disabled module's type reports no format override", canonicalFormatForType("disabled-type") === MARKDOWN_FORMAT);
check("a disabled module contributes no exporters", exportersForType("disabled-type").length === 0);
check("a disabled module's type key is not enumerated", !registeredTypeKeys().includes("disabled-type"));

// --- 5. boundary hygiene ---------------------------------------------------
let threwOnDup = false;
try {
  registerModule(coreModule);
} catch {
  threwOnDup = true;
}
check("registering a duplicate module id throws", threwOnDup);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
