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
//  6. Feature modules and the fold from the old settings keys.
//  7. Contribution slots: a module's MCP tools, instructions, and health check.
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
  hooksFor,
  isModuleEnabled,
  moduleForType,
  referenceModule,
  registerModule,
  registeredTypeKeys,
  setModuleEnabledResolver,
  typeDefFor,
  typeKeysOfDisabledModules,
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
check("person resolves to the default canvas", canvasIdForType("person") === DEFAULT_CANVAS);
for (const t of ["event", "note", "person"]) {
  check(`${t} is markdown-canonical`, canonicalFormatForType(t) === MARKDOWN_FORMAT);
}
check("task keeps its bespoke canvas (ADR-108)", canvasIdForType("task") === "task");
check("event keeps its bespoke canvas (ADR-158)", canvasIdForType("event") === "event");
check("note renders through the shared longform canvas (ADR-157)", canvasIdForType("note") === "longform");
check("link renders through the shared longform canvas (ADR-157)", canvasIdForType("link") === "longform");
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

// --- 4b. the owner's switch (ADR-272 step 1) -------------------------------
// A fake resolver stands in for settings.modules. The reference module (on by
// default, registered above) is the one we flip.
const fakeFlags: Record<string, Record<string, boolean>> = {
  "owner-off": { reference: false, core: false, "disabled-fixture": true },
  "owner-on": { reference: true },
};
setModuleEnabledResolver((id, owner) => (owner ? fakeFlags[owner]?.[id] : undefined));
check("switched off: module reports disabled", isModuleEnabled("reference", "owner-off") === false);
check("switched off: type falls back to the default canvas", canvasIdForType("reference", "owner-off") === DEFAULT_CANVAS);
check("switched off: no exporters", exportersForType("reference", "owner-off").length === 0);
check("switched off: type key not enumerated", !registeredTypeKeys("owner-off").includes("reference"));
check("switched on: module enabled", isModuleEnabled("reference", "owner-on") === true);
check("switched on: own canvas resolves", canvasIdForType("reference", "owner-on") === "reference-canvas");
check("switched on: exporter resolves", exportersForType("reference", "owner-on").length === 1);
check("switched on: type key enumerated", registeredTypeKeys("owner-on").includes("reference"));
check("the switch can turn a default-off module on", canvasIdForType("disabled-type", "owner-off") === "disabled-canvas");
check("no answer from the resolver: manifest default wins", canvasIdForType("reference", "owner-unknown") === "reference-canvas");
check("core cannot be turned off", isModuleEnabled("core", "owner-off") === true);
check("core types keep their canvas when core is 'off'", canvasIdForType("task", "owner-off") === "task");
check("an unknown module id is false", isModuleEnabled("no-such-module", "owner-on") === false);
const offKeys = typeKeysOfDisabledModules({ reference: false, core: false });
check("disabled type keys list the switched-off module's types", offKeys.includes("reference"));
check("disabled type keys never list core types", !offKeys.includes("task"));
check("disabled type keys include a default-off module left alone", offKeys.includes("disabled-type"));
check("disabled type keys drop a default-off module switched on", !typeKeysOfDisabledModules({ "disabled-fixture": true }).includes("disabled-type"));
setModuleEnabledResolver(() => undefined);

// --- 5. boundary hygiene ---------------------------------------------------
let threwOnDup = false;
try {
  registerModule(coreModule);
} catch {
  threwOnDup = true;
}
check("registering a duplicate module id throws", threwOnDup);

// --- 6. feature modules + the fold from the old keys (ADR-272 step 2) -------
// Imported late so the real resolver in enabled.ts cannot touch the checks above.
const { applyLegacyModulePatch, parseSettings, seedModulesFromLegacy } = await import(
  "../src/lib/settings"
);
const { moduleOn } = await import("../src/lib/modules/enabled");
const FEATURE_IDS = ["ai-memory", "live-context", "agent", "youtube-transcripts", "notification-center"];
for (const id of FEATURE_IDS) {
  const m = allModules().find((x) => x.id === id);
  check(`${id} is a registered module`, !!m);
  check(`${id} adds no item types`, m?.types.length === 0);
  check(`${id} is off by default, as its old key was`, m?.enabledByDefault === false);
  check(`${id} has a description for the Modules page`, !!m?.description);
  check(`${id} is off for an owner who never touched it`, moduleOn({ modules: {} }, id) === false);
}
check("feature modules add no type keys", !FEATURE_IDS.some((id) => registeredTypeKeys().includes(id)));
check("moduleOn: an explicit switch wins over the default", moduleOn({ modules: { agent: true } }, "agent") === true);
check("moduleOn: core is always on", moduleOn({ modules: { core: false } }, "core") === true);
check("moduleOn: an unknown module is off", moduleOn({ modules: {} }, "no-such-module") === false);

// Seeding from an older settings blob: nobody's switch flips on upgrade.
check("old key true + no modules entry -> on", seedModulesFromLegacy({ aiMemoryEnabled: true })["ai-memory"] === true);
check("old key false + no modules entry -> off", seedModulesFromLegacy({ liveContextEnabled: false })["live-context"] === false);
check("old key absent -> no entry, so the default applies", !("ai-memory" in seedModulesFromLegacy({})));
check(
  "a modules entry wins over the old key",
  seedModulesFromLegacy({ aiMemoryEnabled: true, modules: { "ai-memory": false } })["ai-memory"] === false
);
check("nested agent.enabled seeds modules.agent", seedModulesFromLegacy({ agent: { enabled: true } }).agent === true);
check(
  "nested youtubeTranscripts.enabled seeds its module",
  seedModulesFromLegacy({ youtubeTranscripts: { enabled: true } })["youtube-transcripts"] === true
);
check("a non-boolean old key is ignored", !("ai-memory" in seedModulesFromLegacy({ aiMemoryEnabled: "yes" })));
check("other modules entries survive the seed", seedModulesFromLegacy({ modules: { songs: false } }).songs === false);

// parseSettings seeds and then stops carrying the old keys, so they are never written back.
const parsed = parseSettings({ aiMemoryEnabled: true, agent: { enabled: true, chatModel: "claude-sonnet-5" } });
check("parseSettings seeds modules from the old keys", parsed.modules["ai-memory"] === true && parsed.modules.agent === true);
check("parseSettings drops aiMemoryEnabled", !("aiMemoryEnabled" in parsed));
check("parseSettings drops agent.enabled but keeps the agent's options", !("enabled" in parsed.agent) && parsed.agent.chatModel === "claude-sonnet-5");
check("a fresh blob has no module entries at all", Object.keys(parseSettings({}).modules).length === 0);

// A write that still uses an old key lands on modules[id].
check("a patch with no switch leaves modules alone", applyLegacyModulePatch({ theme: "dark" }, { agent: true }) === undefined);
check(
  "an old key in a patch beats the stored entry",
  applyLegacyModulePatch({ aiMemoryEnabled: false }, { "ai-memory": true, songs: false })?.["ai-memory"] === false
);
check(
  "an old-key patch keeps the other stored switches",
  applyLegacyModulePatch({ agent: { enabled: true } }, { songs: false })?.songs === false
);
check(
  "a modules patch merges per id",
  JSON.stringify(applyLegacyModulePatch({ modules: { papers: false } }, { songs: false })) ===
    JSON.stringify({ songs: false, papers: false })
);

// --- 7. save hooks (ADR-272 step 3.6) ---------------------------------------
const hookFixture: ModuleManifest = {
  id: "hook-fixture",
  label: "Hook fixture",
  enabledByDefault: true,
  types: [],
  exporters: [],
  hooks: { onBodySave: async () => {} },
};
registerModule(hookFixture);
const listed = (on: boolean) =>
  hooksFor("onBodySave", (id) => (id === "hook-fixture" ? on : true)).some((h) => h.moduleId === "hook-fixture");
check("a module's hook is listed while it is on", listed(true));
check("a module's hook is not listed while it is off", !listed(false));
check("a module with no hook of that name is not listed", !hooksFor("onCreate", () => true).some((h) => h.moduleId === "hook-fixture"));

const passages = allModules().find((m) => m.id === "passages");
check("passages is a registered module", !!passages);
check("passages is on by default (it always ran)", passages?.enabledByDefault === true && moduleOn({ modules: {} }, "passages"));
check("passages adds no item types", passages?.types.length === 0);
check("passages owns an onBodySave hook", typeof passages?.hooks?.onBodySave === "function");
check("youtube-transcripts owns an onCreate hook", typeof allModules().find((m) => m.id === "youtube-transcripts")?.hooks?.onCreate === "function");
check("passages' hook is dropped when the owner switches it off", !hooksFor("onBodySave", (id) => moduleOn({ modules: { passages: false } }, id)).some((h) => h.moduleId === "passages"));

// The runner: a throwing hook is reported and the next one still runs.
const { runEach } = await import("../src/lib/modules/hooks");
const ran: string[] = [];
const reported: unknown[] = [];
await runEach(
  "onBodySave",
  [
    { moduleId: "a", run: async () => { ran.push("a"); throw new Error("boom"); } },
    { moduleId: "b", run: async () => { ran.push("b"); } },
  ],
  { ownerId: "o", itemId: "i", body: null },
  async (_source, _err, opts) => { reported.push(opts.detail); }
);
check("a throwing hook does not stop the next one", ran.join(",") === "a,b");
check("the throwing hook is reported with its module", reported.length === 1 && (reported[0] as { module: string }).module === "a");
// --- 8. contribution slots: MCP tools and health (ADR-272 step 3) -----------
const { moduleInstructions, moduleOwningTool, toolEnabledFor } = await import("../src/lib/modules");
registerModule({
  id: "fake-tools",
  label: "Fake tools",
  enabledByDefault: false,
  types: [],
  exporters: [],
  mcpTools: { names: ["fake_read", "fake_write"], instructions: "FAKE is on." },
  healthCheck: async () => ({ ok: true }),
});
check("a module's tools resolve to that module", ["fake_read", "fake_write"].every((n) => moduleOwningTool(n)?.id === "fake-tools"));
check("a core tool resolves to no module", moduleOwningTool("search_items") === undefined);
check("the share tools stay core", ["share_item", "list_share_links", "revoke_share_link"].every((n) => !moduleOwningTool(n)));
check("ai-memory owns the memory tools", ["get_memory_stumps", "remember"].every((n) => moduleOwningTool(n)?.id === "ai-memory"));
check("live-context owns the context tools", ["get_active_context", "edit_item_body"].every((n) => moduleOwningTool(n)?.id === "live-context"));
const onlyFake = (id: string) => id === "fake-tools";
const noneOn = () => false;
check("module on -> its tools are available", toolEnabledFor("fake_read", onlyFake));
check("module off -> its tools are excluded", !toolEnabledFor("fake_read", noneOn) && !toolEnabledFor("fake_write", noneOn));
check("a core tool is available with every module off", toolEnabledFor("search_items", noneOn));
check("module off -> no instruction block", !moduleInstructions(noneOn).includes("FAKE is on."));
check("module on -> its instruction block", JSON.stringify(moduleInstructions(onlyFake)) === JSON.stringify(["FAKE is on."]));
const memFirst = moduleInstructions((id) => id === "ai-memory" || id === "live-context");
check("memory block comes before live-context (the old order)", memFirst.length === 2 && memFirst[0].includes("AI MEMORY is on") && memFirst[1].includes("LIVE EDITING CONTEXT is on"));
const fakeCheck = allModules().find((m) => m.id === "fake-tools")?.healthCheck;
check("a module's healthCheck is on its manifest", JSON.stringify(await fakeCheck?.("owner")) === JSON.stringify({ ok: true }));
check("youtube-transcripts contributes a health check", typeof allModules().find((m) => m.id === "youtube-transcripts")?.healthCheck === "function");
// --- 7. contribution slots (ADR-272 step 3): nav, publicPaths, requires -----
const { modulePublicPaths, navEntriesForModules, requiresViolations, requirementsOf } =
  await import("../src/lib/modules");
const { CORE_BUILD_NAV, buildNavFor } = await import("../src/lib/build-nav");
const { readFileSync } = await import("node:fs");
const hrefs = (off: string[] = []) => buildNavFor(off).flatMap((g) => g.entries.map((e) => e.href));
const coreHrefs = CORE_BUILD_NAV.flatMap((g) => g.entries.map((e) => e.href));

// nav: the real ai-memory entry moved off the static list onto its manifest.
check("AI Memory is no longer a static core entry", !coreHrefs.includes("/build/memory"));
check("AI Memory comes from the ai-memory manifest", navEntriesForModules().some((e) => e.moduleId === "ai-memory" && e.href === "/build/memory"));
const maintain = (off: string[]) => buildNavFor(off).find((g) => g.label === "MAINTAIN")!.entries.map((e) => e.href);
check("AI Memory sits right after API, where it always was", maintain([]).indexOf("/build/memory") === maintain([]).indexOf("/build/api") + 1);
check("AI Memory drops out when its module is off", !hrefs(["ai-memory"]).includes("/build/memory"));

// nav: a fake module's entries land where they say, and vanish when it is off.
registerModule({
  id: "nav-fixture",
  label: "Nav fixture",
  enabledByDefault: true,
  types: [],
  exporters: [],
  nav: [
    { group: "DATA", label: "Fixture A", href: "/build/fixture-a", icon: "grid", after: "/build/templates" },
    { group: "DATA", label: "Fixture B", href: "/build/fixture-b", icon: "grid", after: "/build/templates" },
    { group: "SYSTEM", label: "Fixture End", href: "/build/fixture-end", icon: "grid" },
    { group: "INTERFACE", label: "Fixture Stray", href: "/build/fixture-stray", icon: "grid", after: "/nowhere" },
  ],
});
const data = buildNavFor([]).find((g) => g.label === "DATA")!.entries.map((e) => e.href);
const t = data.indexOf("/build/templates");
check("a module entry lands right after its after", data[t + 1] === "/build/fixture-a");
check("two entries after the same anchor keep manifest order", data[t + 2] === "/build/fixture-b");
check("an entry with no after goes to the end of its group", buildNavFor([]).find((g) => g.label === "SYSTEM")!.entries.at(-1)?.href === "/build/fixture-end");
check("an entry whose after is unknown goes to the end of its group", buildNavFor([]).find((g) => g.label === "INTERFACE")!.entries.at(-1)?.href === "/build/fixture-stray");
check("a switched-off module's entries are gone", !hrefs(["nav-fixture"]).some((h) => h.startsWith("/build/fixture")));
check(
  "core entries are untouched, in order, with modules off",
  JSON.stringify(hrefs(["nav-fixture", "ai-memory"])) === JSON.stringify(coreHrefs)
);
check("core groups keep their order", buildNavFor([]).map((g) => g.label).join(",") === "DATA,INTERFACE,MAINTAIN,SYSTEM");
const { buildDestOptions } = await import("../src/lib/nav-slot-options");
const toolHrefs = (off: string[]) => buildDestOptions([], [], [], false, off).filter((o) => o.group === "Build tools").map((o) => o.href);
check("the picker offers an enabled module's Build page", toolHrefs([]).includes("/build/memory"));
check("the picker drops a switched-off module's Build page", !toolHrefs(["ai-memory"]).includes("/build/memory"));

// publicPaths: no module declares any yet, so the proxy's list is exactly today's.
check("no registered module declares public paths yet", modulePublicPaths().length === 0);
const TODAY_PUBLIC = [
  "/sign-in(.*)", "/api/machine(.*)", "/api/mcp(.*)", "/.well-known/(.*)",
  "/api/oauth/protected-resource", "/api/oauth/authorization-server", "/api/oauth/register",
  "/api/oauth/token", "/api/todoist/webhook", "/share(.*)", "/api/ics(.*)", "/files/(.*)", "/capture/share",
];
const proxySrc = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const coreBlock = proxySrc.match(/const CORE_PUBLIC_ROUTES = \[([\s\S]*?)\n\];/)?.[1] ?? "";
const corePublic = [...coreBlock.replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check(
  "proxy's merged public list equals today's list exactly",
  JSON.stringify([...corePublic, ...modulePublicPaths()]) === JSON.stringify(TODAY_PUBLIC),
  corePublic.join(" ")
);
check(
  "proxy matches core + module paths",
  proxySrc.includes("createRouteMatcher([...CORE_PUBLIC_ROUTES, ...modulePublicPaths()])")
);
registerModule({
  id: "public-fixture",
  label: "Public fixture",
  enabledByDefault: false,
  types: [],
  exporters: [],
  publicPaths: ["/api/fixture/webhook"],
});
check("a module's public paths are appended, even while it is off", modulePublicPaths().includes("/api/fixture/webhook"));

// requires: a module cannot be on without what it needs.
registerModule({ id: "req-base", label: "Base", enabledByDefault: false, types: [], exporters: [] });
registerModule({ id: "req-mid", label: "Mid", enabledByDefault: false, types: [], exporters: [], requires: ["req-base"] });
registerModule({ id: "req-top", label: "Top", enabledByDefault: false, types: [], exporters: [], requires: ["req-mid", "core"] });
check("the real modules have no requirement violations by default", requiresViolations({}).length === 0);
check("requirement on but dependent off: fine", requiresViolations({ "req-base": true }).length === 0);
const v = requiresViolations({ "req-mid": true });
check("dependent on, requirement off: one violation", v.length === 1 && v[0].moduleId === "req-mid" && v[0].requires === "req-base");
check("the violation message names both modules", v[0]?.message.includes("Mid") && v[0]?.message.includes("Base"));
check("everything on: no violations", requiresViolations({ "req-base": true, "req-mid": true, "req-top": true }).length === 0);
check("core always satisfies a requirement", !requiresViolations({ "req-top": true, "req-mid": true, "req-base": true, core: false }).some((x) => x.requires === "core"));
check("requirementsOf walks the chain", JSON.stringify(requirementsOf("req-top").sort()) === JSON.stringify(["core", "req-base", "req-mid"]));
check("isModuleEnabled ignores requires (a plain lookup)", isModuleEnabled("req-mid") === false && moduleOn({ modules: { "req-mid": true } }, "req-mid") === true);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
