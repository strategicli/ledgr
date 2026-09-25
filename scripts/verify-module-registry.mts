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

// Server-only slots (hooks, healthCheck) are attached outside the pure manifests.
await import("../src/lib/modules/server-slots");

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
check("passages is off by default for new installs", passages?.enabledByDefault === false && !moduleOn({ modules: {} }, "passages"));
check("an owner backfilled by 0064 keeps passages on", moduleOn({ modules: { passages: true } }, "passages"));
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
check("sharing owns the share tools", ["share_item", "list_share_links", "revoke_share_link"].every((n) => moduleOwningTool(n)?.id === "sharing"));
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
  JSON.stringify(hrefs(["nav-fixture", "ai-memory", "relatedness"])) === JSON.stringify(coreHrefs)
);
check("core groups keep their order", buildNavFor([]).map((g) => g.label).join(",") === "DATA,INTERFACE,MAINTAIN,SYSTEM");
const { buildDestOptions } = await import("../src/lib/nav-slot-options");
const toolHrefs = (off: string[]) => buildDestOptions([], [], [], false, off).filter((o) => o.group === "Build tools").map((o) => o.href);
check("the picker offers an enabled module's Build page", toolHrefs([]).includes("/build/memory"));
check("the picker drops a switched-off module's Build page", !toolHrefs(["ai-memory"]).includes("/build/memory"));

// publicPaths: the proxy's merged list is the same set it always was. Todoist
// (step 4) moved "/api/todoist/webhook" and sharing moved "/share(.*)" off the
// core list onto their manifests, so both now come from modulePublicPaths().
check("the Todoist webhook comes from the module list", modulePublicPaths().includes("/api/todoist/webhook"));
check("sharing declares the share page's public path", JSON.stringify(allModules().find((m) => m.id === "sharing")?.publicPaths) === JSON.stringify(["/share(.*)"]));
const TODAY_PUBLIC = [
  "/sign-in(.*)", "/api/machine(.*)", "/api/mcp(.*)", "/.well-known/(.*)",
  "/api/oauth/protected-resource", "/api/oauth/authorization-server", "/api/oauth/register",
  "/api/oauth/token", "/api/ics(.*)", "/files/(.*)", "/capture/share",
  ...modulePublicPaths(),
];
const proxySrc = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
const coreBlock = proxySrc.match(/const CORE_PUBLIC_ROUTES = \[([\s\S]*?)\n\];/)?.[1] ?? "";
const corePublic = [...coreBlock.replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
check("/share is no longer on the proxy's core list", !corePublic.includes("/share(.*)"));
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

// --- 8. step 4: modules that live under src/modules/<id>/ ------------------
const { passagesModule } = await import("../src/modules/passages/manifest");
const { youtubeTranscriptsModule } = await import("../src/modules/youtube-transcripts/manifest");
const { existsSync } = await import("node:fs");
const { FEATURE_MODULES } = await import("../src/lib/modules/features");
for (const moved of [passagesModule, youtubeTranscriptsModule]) {
  check(`${moved.id} is registered from src/modules`, allModules().find((m) => m.id === moved.id) === moved);
  check(`${moved.id} left features.ts`, !FEATURE_MODULES.some((m) => m.id === moved.id));
  check(`${moved.id} names its route files`, (moved.routes?.length ?? 0) > 0);
  for (const r of moved.routes ?? []) {
    check(`${moved.id} route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
  }
}
check("passages defaults off (existing owners carry an explicit true)", passagesModule.enabledByDefault === false);
check("youtube-transcripts keeps its default (off)", youtubeTranscriptsModule.enabledByDefault === false);
check("server-slots attached passages' onBodySave", typeof passagesModule.hooks?.onBodySave === "function");
check(
  "server-slots attached youtube's onCreate and healthCheck",
  typeof youtubeTranscriptsModule.hooks?.onCreate === "function" &&
    typeof youtubeTranscriptsModule.healthCheck === "function"
);
const gate = await import("../src/lib/modules/gate");
check(
  "the route gate helpers are exported",
  [gate.moduleIsOn, gate.routeGate, gate.pageGate].every((f) => typeof f === "function")
);
const passagePage = readFileSync(new URL("../src/app/passage/[ref]/page.tsx", import.meta.url), "utf8");
check("the passage page calls the gate", passagePage.includes('pageGate(owner.id, "passages")'));
// --- 9. step 4: the todoist module lives under src/modules/todoist ---------
{
  const { todoistModule } = await import("../src/modules/todoist/manifest");
  const { existsSync } = await import("node:fs");
  const registered = allModules().find((m) => m.id === "todoist");
  check("todoist is registered from @/modules/todoist/manifest", registered === todoistModule);
  check(
    "register.ts imports the todoist manifest from its module folder",
    readFileSync(new URL("../src/lib/modules/register.ts", import.meta.url), "utf8").includes(
      'from "@/modules/todoist/manifest"'
    )
  );
  check("todoist is off by default", todoistModule.enabledByDefault === false && moduleOn({ modules: {} }, "todoist") === false);
  check("todoist has a description for the Modules page", !!todoistModule.description);
  check("todoist owns its webhook's public path", todoistModule.publicPaths?.includes("/api/todoist/webhook") === true);
  check("the core proxy list no longer names the Todoist webhook", !corePublic.includes("/api/todoist/webhook"));
  const routes = todoistModule.routes ?? [];
  check("todoist lists its three route files", routes.length === 3);
  for (const r of routes) check(`todoist route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
  check("todoist contributes a health check (server slot)", typeof registered?.healthCheck === "function");
  check("the todoist-sync job is gated by the todoist module", (await import("../src/lib/job-owners")).jobModuleOff("todoist-sync", ["todoist"]));
  const gate = await import("../src/lib/modules/gate");
  check(
    "the gate helpers are exported",
    typeof gate.moduleIsOn === "function" && typeof gate.routeGate === "function" && typeof gate.pageGate === "function"
  );
  for (const r of ["src/app/api/todoist/sync/route.ts", "src/app/api/todoist/webhook/route.ts"]) {
    check(`${r} calls routeGate for todoist`, readFileSync(new URL(`../${r}`, import.meta.url), "utf8").includes('routeGate(owner'));
  }
}
// --- 10. step 4: sharing lives under src/modules/sharing ---------------------
{
const { existsSync } = await import("node:fs");
const sharing = allModules().find((m) => m.id === "sharing");
check("sharing is a registered module, on by default", !!sharing && sharing.enabledByDefault === true && moduleOn({ modules: {} }, "sharing"));
check("sharing adds no item types", sharing?.types.length === 0);
check("sharing names its three tools", JSON.stringify(sharing?.mcpTools?.names) === JSON.stringify(["share_item", "list_share_links", "revoke_share_link"]));
check(
  "sharing's server.ts attaches exactly those tool definitions",
  JSON.stringify(sharing?.mcpTools?.tools?.map((x) => x.name)) === JSON.stringify(sharing?.mcpTools?.names)
);
const sharingRoutes = sharing?.routes ?? [];
check("sharing lists its route files", sharingRoutes.length === 2);
for (const r of sharingRoutes) {
  check(`route file exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
}
check("sharing is off -> the share page's switch reads off", !moduleOn({ modules: { sharing: false } }, "sharing"));
const gate = await import("../src/lib/modules/gate");
check("the gate exports moduleIsOn, routeGate and pageGate", ["moduleIsOn", "routeGate", "pageGate"].every((k) => typeof (gate as Record<string, unknown>)[k] === "function"));
for (const r of sharingRoutes) {
  const src = readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
  check(`route calls the gate: ${r}`, /from "@\/lib\/modules\/gate"/.test(src));
}
}
// --- 11. step 4: onedrive-export and snapshots under src/modules -------------
{
  const { existsSync } = await import("node:fs");
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const { onedriveExportModule } = await import("../src/modules/onedrive-export/manifest");
  const { snapshotsModule } = await import("../src/modules/snapshots/manifest");
  const exp = allModules().find((m) => m.id === "onedrive-export");
  const snap = allModules().find((m) => m.id === "snapshots");
  check("onedrive-export is registered from its module folder", exp === onedriveExportModule);
  check("snapshots is registered from its module folder", snap === snapshotsModule);
  check("onedrive-export is on by default", onedriveExportModule.enabledByDefault && moduleOn({ modules: {} }, "onedrive-export"));
  check("snapshots is on by default", snapshotsModule.enabledByDefault && moduleOn({ modules: {} }, "snapshots"));
  for (const m of [onedriveExportModule, snapshotsModule]) {
    check(`${m.id} has a description and adds no types`, !!m.description && m.types.length === 0);
    for (const r of m.routes ?? []) {
      check(`${m.id} route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
      if (!r.includes("/api/machine/")) {
        check(`${r} imports the module gate`, /from "@\/lib\/modules\/gate"/.test(read(r)));
      }
    }
  }
  // Shared job: the step 3 verdict never runs for it, so the route checks itself.
  check("the snapshot job route checks the snapshots module", read("src/app/api/machine/snapshot/route.ts").includes('moduleIsOn(ownerId, "snapshots")'));
  check("the export job is gated by the onedrive-export module", (await import("../src/lib/job-owners")).jobModuleOff("export", ["onedrive-export"]));
  // The engine is core (Principle 4): it takes a target and never imports one.
  const engine = read("src/lib/export/engine.ts");
  check("the export engine imports no module", !/@\/modules|src\/modules/.test(engine));
  check("the export engine does not import the OneDrive target", !/onedrive/i.test(engine.split("\n").filter((l) => l.startsWith("import")).join("\n")));
  check("the OneDrive target left src/lib/export", !existsSync(new URL("../src/lib/export/onedrive.ts", import.meta.url)));
  check("health.ts no longer reads export state itself", !read("src/lib/health.ts").includes("getExportState"));
  check("onedrive-export contributes a health check (server slot)", typeof exp?.healthCheck === "function");
}
// --- 12. step 4: email-capture and calendar-sync live under src/modules ------
{
  const { existsSync } = await import("node:fs");
  const { emailCaptureModule } = await import("../src/modules/email-capture/manifest");
  const { calendarSyncModule } = await import("../src/modules/calendar-sync/manifest");
  const { JOB_CATALOG, jobModuleOff } = await import("../src/lib/job-owners");
  const registerSrc = readFileSync(new URL("../src/lib/modules/register.ts", import.meta.url), "utf8");
  const jobs: Record<string, string> = { "email-capture": "email-import", "calendar-sync": "calendar-sync" };
  for (const m of [emailCaptureModule, calendarSyncModule]) {
    check(`${m.id} is registered from @/modules/${m.id}/manifest`, allModules().find((x) => x.id === m.id) === m);
    check(`register.ts imports ${m.id} from its module folder`, registerSrc.includes(`from "@/modules/${m.id}/manifest"`));
    check(`${m.id} is on by default (its job runs by default)`, m.enabledByDefault === true && moduleOn({ modules: {} }, m.id));
    check(`${m.id} has a description for the Modules page`, !!m.description);
    check(`${m.id} adds no item types`, m.types.length === 0);
    check(`${m.id} contributes a health check (server slot)`, typeof m.healthCheck === "function");
    const job = jobs[m.id];
    check(`the ${job} job names ${m.id} as its module`, JOB_CATALOG[job]?.module === m.id);
    check(`the ${job} job stands down while ${m.id} is off`, jobModuleOff(job, [m.id]));
    const routes = m.routes ?? [];
    check(`${m.id} names its route files`, routes.length > 0);
    for (const r of routes) {
      check(`${m.id} route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
      if (r.includes("/api/machine/")) continue; // gated by the job verdict
      const src = readFileSync(new URL(`../${r}`, import.meta.url), "utf8");
      check(`${m.id} route calls the gate: ${r}`, /from "@\/lib\/modules\/gate"/.test(src) && src.includes(`"${m.id}")`));
    }
  }
  check("email-capture owns the three email routes", emailCaptureModule.routes?.length === 3);
  check("calendar-sync owns sync, matchers and its job route", calendarSyncModule.routes?.length === 4);
}
// --- 13. step 4: relatedness lives under src/modules/relatedness --------------
{
  const { relatednessModule } = await import("../src/modules/relatedness/manifest");
  const { existsSync } = await import("node:fs");
  check("relatedness is registered from @/modules/relatedness/manifest", allModules().find((m) => m.id === "relatedness") === relatednessModule);
  check("relatedness is on by default (the job always ran)", relatednessModule.enabledByDefault === true && moduleOn({ modules: {} }, "relatedness"));
  check("relatedness has a description for the Modules page", !!relatednessModule.description);
  check("relatedness adds no item types", relatednessModule.types.length === 0);
  check(
    "Loose Ends comes from the relatedness manifest",
    navEntriesForModules().some((e) => e.moduleId === "relatedness" && e.href === "/build/loose-ends" && e.group === "MAINTAIN")
  );
  check("Loose Ends is no longer a static core entry", !coreHrefs.includes("/build/loose-ends"));
  const buildNavSrc = readFileSync(new URL("../src/lib/build-nav.ts", import.meta.url), "utf8");
  check("build-nav.ts no longer lists Loose Ends", !/href:\s*"\/build\/loose-ends"/.test(buildNavSrc));
  check("Loose Ends sits right after Data Hygiene", maintain([]).indexOf("/build/loose-ends") === maintain([]).indexOf("/build/hygiene") + 1);
  check("Loose Ends drops out when relatedness is off", !hrefs(["relatedness"]).includes("/build/loose-ends"));
  const routes = relatednessModule.routes ?? [];
  check("relatedness lists its four route files", routes.length === 4);
  for (const r of routes) {
    check(`relatedness route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
    // The explore route is core (src/app/items/**) and reaches the module through
    // module-panels.tsx, whose ExploreView calls the gate; the machine route is
    // gated as a job. Every other route imports the gate itself.
    if (r.includes("/api/machine/") || r.includes("/explore/")) continue;
    check(`relatedness route calls the gate: ${r}`, /from "@\/lib\/modules\/gate"/.test(readFileSync(new URL(`../${r}`, import.meta.url), "utf8")));
  }
  const exploreView = readFileSync(new URL("../src/modules/relatedness/components/ExploreView.tsx", import.meta.url), "utf8");
  check("the Explore view calls the gate", exploreView.includes('pageGate(owner.id, "relatedness")'));
  const machine = readFileSync(new URL("../src/app/api/machine/relatedness/route.ts", import.meta.url), "utf8");
  check("the relatedness job stands down when the module is off", machine.includes('moduleIsOn(ownerId, "relatedness")'));
  check("the relatedness job is tied to the module in jobs.json", (await import("../src/lib/job-owners")).jobModuleOff("relatedness", ["relatedness"]));
  check("server-slots attached relatedness' healthCheck", typeof relatednessModule.healthCheck === "function");
}
// --- 14. step 4: the in-app agent lives under src/modules/agent ---------------
{
  const { agentModule } = await import("../src/modules/agent/manifest");
  const { moduleAvailable } = await import("../src/lib/modules");
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  check("agent is registered from @/modules/agent/manifest", allModules().find((m) => m.id === "agent") === agentModule);
  check("agent is gone from features.ts", !read("src/lib/modules/features.ts").includes('"agent"'));
  check("agent is off by default", agentModule.enabledByDefault === false && moduleOn({ modules: {} }, "agent") === false);
  check("agent declares whether this machine can run it", typeof agentModule.available === "function");
  const prev = process.env.LEDGR_AGENT;
  process.env.LEDGR_AGENT = "off";
  check("moduleAvailable reads the manifest (forced off)", moduleAvailable("agent") === false);
  process.env.LEDGR_AGENT = "on";
  check("moduleAvailable reads the manifest (forced on)", moduleAvailable("agent") === true);
  if (prev === undefined) delete process.env.LEDGR_AGENT;
  else process.env.LEDGR_AGENT = prev;
  check("a module without `available` is available", moduleAvailable("relatedness") === true);
  const routes = agentModule.routes ?? [];
  check("agent lists its twelve route files", routes.length === 12);
  for (const r of routes) {
    check(`agent route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
    // The machine route is checked below; health answers while the module is
    // off on purpose (Settings' "Check sign-in" before switching it on).
    if (r.includes("/api/machine/") || r.includes("/agent/health/")) continue;
    check(`agent route calls the gate: ${r}`, read(r).includes("requireAgentOwner(request)"));
  }
  check("requireAgentOwner uses the shared module gate", read("src/modules/agent/lib/gate.ts").includes('moduleIsOn(owner.id, "agent")'));
  check("the agent-purge job stands down when the module is off", read("src/app/api/machine/agent-purge/route.ts").includes('moduleIsOn(ownerId, "agent")'));
  const layout = read("src/app/layout.tsx");
  check("layout.tsx imports nothing from the agent module", !/from "@\/modules\/agent|agent\/gate|AgentPanel/.test(layout));
  check("layout.tsx mounts the shell panels", layout.includes("shellPanels()"));
  check("shellPanels() lists the agent", /moduleId: "agent", Component: AgentShellPanel/.test(read("src/lib/module-shells.tsx")));
  check("the editor reaches inline edit through module-editor.tsx", !read("src/components/markdown-editor/MarkdownEditor.tsx").includes("@/modules/"));
  check("verify-agent follows the move", read("scripts/verify-agent.mts").includes("../src/modules/agent/lib/tools"));
  check("server-slots attached the agent's healthCheck", typeof agentModule.healthCheck === "function");
}

// --- 14. step 4: the Desk lives under src/modules/desk ------------------------
{
  const { deskModule } = await import("../src/modules/desk/manifest");
  const { existsSync, readdirSync } = await import("node:fs");
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  check("desk is registered from @/modules/desk/manifest", allModules().find((m) => m.id === "desk") === deskModule);
  check("desk is on by default (used daily)", deskModule.enabledByDefault === true && moduleOn({ modules: {} }, "desk"));
  check("desk has a description for the Modules page", !!deskModule.description);
  check("desk adds no item types", deskModule.types.length === 0);
  const routes = deskModule.routes ?? [];
  check("desk lists its one route file", JSON.stringify(routes) === JSON.stringify(["src/app/desk/page.tsx"]));
  for (const r of routes) {
    check(`desk route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
    check(`desk route calls the gate: ${r}`, src(r).includes('pageGate(owner.id, "desk")'));
  }
  check("the old desk folders are gone", !existsSync(new URL("../src/lib/desk", import.meta.url)) && !existsSync(new URL("../src/components/desk", import.meta.url)));
  // The shell slot: the root layout mounts module panels from shellPanels(),
  // filtered by the owner's switches, and the Desk's send menu is one of them.
  check("shellPanels() lists the desk send menu", /moduleId:\s*"desk",\s*Component:\s*DeskSendShellPanel/.test(src("src/lib/module-shells.tsx")));
  const layout = src("src/app/layout.tsx");
  // The layout gates each shell panel on `shellOn`, which is moduleOn AND the
  // manifest's `available` (the agent module's machine check).
  check("the root layout maps shellPanels() gated by the module switch", /shellPanels\(\)\s*\.filter\(\(p\) => shellOn\(p\.moduleId\)\)/.test(layout) && layout.includes("moduleOn(s, moduleId) && moduleAvailable(moduleId)"));
  // The fenced core files that used to import desk code no longer do.
  for (const f of [
    "src/lib/settings.ts",
    "src/app/layout.tsx",
    "src/components/markdown-editor/MarkdownEditor.tsx",
    "src/components/markdown-editor/MarkdownPreview.tsx",
  ]) {
    check(`${f} imports no desk code`, !/from "[^"]*\/desk\//.test(src(f)));
  }
  // The editor reaches the menu through core's inline-ref seam: no listener
  // (Desk off) means it is unavailable and the native menu stays.
  const ref = await import("../src/lib/inline-ref-menu");
  check("no listener: the inline menu is unavailable", !ref.inlineRefMenuAvailable());
  let opened = "";
  const unlisten = ref.listenInlineRefMenu({ available: () => true, open: (d) => (opened = d.itemId) });
  ref.openInlineRefMenu({ itemId: "x", x: 0, y: 0 });
  check("a listener makes it available and receives the click", ref.inlineRefMenuAvailable() && opened === "x");
  unlisten();
  check("unlistening makes it unavailable again", !ref.inlineRefMenuAvailable());
  // settings keeps workspaces as an opaque slot; the module validates layouts.
  const { parseSettings } = await import("../src/lib/settings");
  const parsed = parseSettings({ deskWorkspaces: [{ id: "a", name: "A", savedAt: 1, layout: { version: -1 } }, { id: "b", name: "B", layout: "nope" }] });
  check("core keeps an object layout it cannot read, drops a non-object", parsed.deskWorkspaces.length === 1 && parsed.deskWorkspaces[0].id === "a");
  const { sanitizeWorkspaces } = await import("../src/modules/desk/lib/workspaces");
  check("the module drops a workspace whose layout fails sanitizeLayout", sanitizeWorkspaces(parsed.deskWorkspaces).length === 0);
  // Work nav: /desk is not offered, and an existing slot hides, while off.
  const { buildDestOptions, offModuleHrefs } = await import("../src/lib/nav-slot-options");
  const builtins = (off: string[]) => buildDestOptions([], [], [], false, off).filter((o) => o.group === "Built-in").map((o) => o.href);
  check("the picker offers /desk while desk is on", builtins([]).includes("/desk"));
  check("the picker drops /desk while desk is off", !builtins(["desk"]).includes("/desk"));
  check("Nav hides a /desk slot while desk is off", offModuleHrefs(["desk"]).has("/desk") && !offModuleHrefs([]).has("/desk"));
  check("there are no verify-desk scripts to repoint", !readdirSync(new URL("./", import.meta.url)).some((f) => f.startsWith("verify-desk")));
}

// --- 16. step 4: ai-memory and live-context live under src/modules -----------
{
  const { existsSync } = await import("node:fs");
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const { aiMemoryModule } = await import("../src/modules/ai-memory/manifest");
  const { liveContextModule } = await import("../src/modules/live-context/manifest");
  const { FEATURE_MODULES } = await import("../src/lib/modules/features");
  const { moduleResources } = await import("../src/lib/modules");
  const registerSrc = read("src/lib/modules/register.ts");
  const serverSlotsSrc = read("src/lib/modules/server-slots.ts");
  for (const m of [aiMemoryModule, liveContextModule]) {
    check(`${m.id} is registered from @/modules/${m.id}/manifest`, allModules().find((x) => x.id === m.id) === m);
    check(`register.ts imports ${m.id} from its module folder`, registerSrc.includes(`from "@/modules/${m.id}/manifest"`));
    check(`${m.id} left features.ts`, !FEATURE_MODULES.some((x) => x.id === m.id));
    check(`${m.id} is off by default`, m.enabledByDefault === false && moduleOn({ modules: {} }, m.id) === false);
    check(`${m.id} has a description and adds no types`, !!m.description && m.types.length === 0);
    check(`server-slots imports ${m.id}'s server.ts`, serverSlotsSrc.includes(`import "@/modules/${m.id}/server"`));
    check(
      `${m.id}'s server.ts attaches exactly the tools its manifest names`,
      JSON.stringify(m.mcpTools?.tools?.map((x) => x.name)) === JSON.stringify(m.mcpTools?.names)
    );
    const routes = m.routes ?? [];
    check(`${m.id} names its route files`, routes.length > 0);
    for (const r of routes) {
      check(`${m.id} route exists: ${r}`, existsSync(new URL(`../${r}`, import.meta.url)));
      check(`${m.id} route calls the gate: ${r}`, /from "@\/lib\/modules\/gate"/.test(read(r)) && read(r).includes(`"${m.id}")`));
    }
  }
  check("ai-memory owns /build/memory", JSON.stringify(aiMemoryModule.routes) === JSON.stringify(["src/app/build/memory/page.tsx"]));
  check("live-context owns both active-context routes", liveContextModule.routes?.length === 2);
  // The tool registry collects the two families from the modules, not by file.
  const toolsIndex = read("src/lib/mcp/tools/index.ts");
  check("tools/index.ts does not import the memory tools", !/from "\.\/memory"|tools\/memory|ai-memory/.test(toolsIndex));
  check("tools/index.ts does not import the context tools", !/from "\.\/context"|tools\/context|live-context/.test(toolsIndex));
  check("the old tool files are gone", !existsSync(new URL("../src/lib/mcp/tools/memory.ts", import.meta.url)) && !existsSync(new URL("../src/lib/mcp/tools/context.ts", import.meta.url)));
  check("search_items no longer imports the memory lib", !/memory/i.test(read("src/lib/mcp/tools/items.ts").split("\n").filter((l) => l.startsWith("import")).join("\n")));
  check("ai-memory contributes the search_items hook (server slot)", typeof aiMemoryModule.mcpSearchHits === "function");
  // The memory protocol resource comes from the module, not from core.
  const onRes = moduleResources((id) => id === "ai-memory");
  check("the memory protocol is the ai-memory module's resource", onRes.length === 1 && onRes[0].uri === "ledgr://guide/memory-protocol");
  check("…and reads as the protocol text", onRes[0]?.read().startsWith("# Working with the owner's memory") === true);
  check("…and is gone while ai-memory is off", moduleResources(() => false).length === 0);
  const mcpServer = read("src/lib/mcp/server.ts");
  check("mcp/server.ts no longer names the memory protocol", !/MEMORY_PROTOCOL|"ai-memory"/.test(mcpServer));
  check("mcp/server.ts collects module resources", mcpServer.includes("moduleResources("));
  check("guide.ts no longer holds the memory protocol", !/MEMORY_PROTOCOL/.test(read("src/lib/mcp/guide.ts")));
  // The canvas reaches the tracker through module-panels, never directly.
  const itemCanvas = read("src/components/canvas/ItemCanvas.tsx");
  check("ItemCanvas does not import ActiveContextTracker", !/import .*ActiveContextTracker/.test(itemCanvas));
  check("ItemCanvas mounts the live-context panel", itemCanvas.includes('<ModuleItemPanel id="live-context"'));
  const panels = read("src/lib/module-panels.tsx");
  check("module-panels maps live-context to the module's panel", panels.includes('"live-context": LiveContextPanel'));
  check("the live-context panel calls the switch", read("src/modules/live-context/components/LiveContextPanel.tsx").includes('moduleOnFor(owner.id, "live-context")'));
  check("the active_context table carries its ownership note", /Owned by the live-context module/.test(read("src/db/schema.ts")));
}

// --- 17. Modules-page follow-ups: settingsPanel + perInstallNote ------------
// A literal allow-list, so a future module declaring either field is a
// deliberate addition to this test, not a silent gap.
{
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const { existsSync } = await import("node:fs");
  const { agentModule } = await import("../src/modules/agent/manifest");
  const { snapshotsModule } = await import("../src/modules/snapshots/manifest");

  check("agent declares its settingsPanel", agentModule.settingsPanel === "agent");
  const panelsSrc = read("src/lib/module-panels.tsx");
  check(
    "the agent's settingsPanel id resolves in module-panels.tsx",
    new RegExp(`MODULE_SETTINGS_PANELS[\\s\\S]*?agent:\\s*AgentSettingsPanel`).test(panelsSrc)
  );

  check(
    "snapshots declares a perInstallNote",
    !!snapshotsModule.perInstallNote?.text && !!snapshotsModule.perInstallNote?.href
  );
  const href = snapshotsModule.perInstallNote?.href ?? "";
  const routeFile = `src/app${href}/page.tsx`;
  check(
    `snapshots' perInstallNote href exists as a route: ${href}`,
    existsSync(new URL(`../${routeFile}`, import.meta.url))
  );

  const SETTINGS_PANEL_MODULES = ["agent"];
  const PER_INSTALL_NOTE_MODULES = ["snapshots"];
  check(
    "no other module declares settingsPanel",
    allModules().every((m) => !m.settingsPanel || SETTINGS_PANEL_MODULES.includes(m.id))
  );
  check(
    "no other module declares perInstallNote",
    allModules().every((m) => !m.perInstallNote || PER_INSTALL_NOTE_MODULES.includes(m.id))
  );
}

// --- 18. step 5: module client components load lazily ----------------------
// A module that is off must ship no client JavaScript. Each module client
// component the importer files hand to core goes through next/dynamic in a
// client file (next/dynamic in a server file still bundles the client code), so
// a static import of one of these fails here. Server components (SharePanel,
// DiscoverSection, ExploreView, LiveContextPanel) stay static in
// module-panels.tsx: they never reach the browser.
{
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const editor = read("src/lib/module-editor.tsx");
  check("module-editor.tsx is a client file", /^\s*"use client";/m.test(editor));
  const LAZY = [
    "@/modules/agent/components/InlineEdit",
    "@/modules/agent/components/AgentPanel",
    "@/modules/desk/components/DeskSendMenu",
  ];
  for (const path of LAZY) {
    check(`module-editor.tsx loads ${path} through dynamic()`, editor.includes(`dynamic(() => import("${path}")`));
  }
  for (const f of ["src/lib/module-editor.tsx", "src/lib/module-panels.tsx", "src/lib/module-shells.tsx"]) {
    const text = read(f);
    for (const path of LAZY) {
      check(`${f} has no static import of ${path}`, !new RegExp(`^(import|export)[^;]*from "${path}"`, "m").test(text));
    }
  }
  const layout = read("src/app/layout.tsx");
  check("layout.tsx still imports nothing from @/modules", !layout.includes("@/modules"));
  // The root layout reaches the shell panels through module-shells.tsx, never
  // module-panels.tsx, which would put every item panel's client code in every
  // page's first load.
  check(
    "layout.tsx takes shellPanels from module-shells.tsx",
    layout.includes(`from "@/lib/module-shells"`) && !layout.includes("@/lib/module-panels")
  );
  check("module-shells.tsx imports no module directly", !read("src/lib/module-shells.tsx").includes("@/modules"));
}
// --- step 4: microsoft is the parent of the three Graph modules ------------
{
  const { microsoftModule } = await import("../src/modules/microsoft/manifest");
  const { existsSync } = await import("node:fs");
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  check("microsoft is registered from its module folder", allModules().find((x) => x.id === "microsoft") === microsoftModule);
  check("microsoft is on by default", microsoftModule.enabledByDefault && moduleOn({ modules: {} }, "microsoft"));
  check("microsoft contributes a health check (server slot)", typeof microsoftModule.healthCheck === "function");
  for (const id of ["calendar-sync", "email-capture", "onedrive-export"]) {
    check(`${id} requires microsoft`, !!allModules().find((x) => x.id === id)?.requires?.includes("microsoft"));
  }
  check("turning microsoft off with its dependents on is a violation", requiresViolations({ microsoft: false }).length === 3);
  check(
    "microsoft off is fine once its dependents are off",
    requiresViolations({ microsoft: false, "calendar-sync": false, "email-capture": false, "onedrive-export": false }).length === 0
  );
  check("the old Graph client path is gone", !existsSync(new URL("../src/lib/graph/client.ts", import.meta.url)));
  check("health.ts no longer imports the Graph client", !read("src/lib/health.ts").includes("microsoft/lib/client"));
}

// --- 19. step 4: triage mode lives under src/modules/triage ----------------
{
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const { triageModule } = await import("../src/modules/triage/manifest");
  check("triage is registered from @/modules/triage/manifest", allModules().find((m) => m.id === "triage") === triageModule);
  check("triage is on by default (it shipped with no switch)", moduleOn({ modules: {} }, "triage"));
  check("the triage page calls the gate", read("src/app/inbox/triage/page.tsx").includes('pageGate(owner.id, "triage")'));
  check("the Inbox hides its Triage link when the module is off", read("src/app/inbox/page.tsx").includes('moduleOnFor(owner.id, "triage")'));
}

// --- 20. step 4: listen lives under src/modules/listen ---------------------
{
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const { listenModule } = await import("../src/modules/listen/manifest");
  check("listen is registered from @/modules/listen/manifest", allModules().find((m) => m.id === "listen") === listenModule);
  check("listen is on by default (it shipped with no switch)", moduleOn({ modules: {} }, "listen"));
  check("the listen route calls the gate", read("src/app/api/types/[key]/listen/route.ts").includes('routeGate(owner.id, "listen")'));
  const canvas = read("src/components/canvas/ItemCanvas.tsx");
  check("ItemCanvas mounts Listen only while the module is on", canvas.includes('moduleOn(settings, "listen")'));
  check(
    "module-editor.tsx loads ListenBar through dynamic()",
    read("src/lib/module-editor.tsx").includes('dynamic(() => import("@/modules/listen/components/ListenBar")')
  );
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
