// The module-registration boundary (roadmap M6, ADR-043). A *module* packages a
// workflow as a unit — its system type(s), each type's canonical body format and
// canvas, deterministic exporters, and an optional integration — and contributes
// that bundle onto core rather than reaching into it (Tyler's PR #1 §1; CLAUDE.md
// "Building together" lists the module-system boundary as core). Core itself is
// the first module (`coreModule` below), so the whole app resolves type behavior
// through this one boundary — the strongest proof it's real, and the shape every
// workflow module (Papers, Songs, …) follows later, with per-user enable as a
// config flip (the `isModuleEnabled` seam, driven by settings.modules, ADR-272).
//
// This is the POLICY/CONTRACT half and is kept pure: it imports no React
// component and nothing heavy, so it resolves identically on the server and in a
// plain-node verify script (the discipline M5 set for canvas-registry, ADR-041).
// Canvas *components* are the one thing that can't be pure, so they live in
// `module-wiring.tsx`, linked back here by `canvasId` (a string). Exporters are
// deterministic code (Principle 7), so an exporter's `render` lives directly on
// its def — a real module with a heavy renderer (pandoc → docx) keeps that in its
// own module file, which this core registry never imports, so core stays
// node-pure.
import type { ReactNode } from "react";
import type { getItem } from "@/lib/items";
import { MARKDOWN_FORMAT, type ItemBody } from "@/lib/body";
import type { McpTool } from "@/lib/mcp/tools/wire";
import type { SearchResult } from "@/lib/search";

// --- canvas contract (re-homed from canvas-registry, ADR-041) --------------

// The loaded item a canvas renders, derived from getItem so it can't drift from
// the real row shape.
export type CanvasItem = Awaited<ReturnType<typeof getItem>>;

// Every canvas — default or module — receives the same context: the loaded,
// owner-checked, non-trashed item, its owner, and which surface it's on.
export type CanvasProps = {
  item: CanvasItem;
  ownerId: string;
  variant: "page" | "modal";
  // Arrange mode for the default canvas's per-type layout (ADR-069, Feature B):
  // true only on the full-page ?arrange=1 route. Module canvases ignore it.
  arrange?: boolean;
};

// Canvases are (often async) server components — a function returning rendered
// output. Only the canvas *id* (a string) is resolved in this pure file; the
// actual component is wired in module-wiring.tsx.
export type CanvasComponent = (
  props: CanvasProps
) => ReactNode | Promise<ReactNode>;

// The default canvas id — the markdown editor + the type's standard panels
// (MarkdownCanvas). Any type that doesn't declare its own canvas renders through
// it.
export const DEFAULT_CANVAS = "markdown";

// --- the module contract ---------------------------------------------------

// A deterministic export of an item to a derived artifact — no model in the loop
// (Principle 7): markdown → docx (Papers), ChordPro → chart (Songs). `render` is
// plain code on the def. (The OneDrive export *engine* is core infrastructure,
// not one of these per-type module exporters.)
export type ExporterRender = (
  body: ItemBody,
  item: CanvasItem
) => string | Promise<string>;

export type ExporterDef = {
  id: string;
  label: string;
  forType: string; // the type key this exporter renders
  fileExtension: string; // "docx" | "pdf" | "txt" | …
  render: ExporterRender;
};

// An optional provider-seam integration a module brings (Savor pull, PCO push).
// Metadata only here; the adapter itself lives behind the relevant provider
// interface (the same discipline as storage/calendar/mail).
export type IntegrationDef = {
  id: string;
  label: string;
  direction: "pull" | "push" | "bidirectional";
};

// --- surfaces (ADR-260) ----------------------------------------------------
//
// A SURFACE is one named place content lives on an item of this type. Most types
// have exactly one (the markdown body) and never think about it. A bespoke type
// has several: a paper is Notes + Shape + Quote Bank + Outline + Draft, a song is
// Notes + Chart. Those surfaces were real in the canvas from the day each module
// shipped, but they existed ONLY as canvas-local knowledge — the canvas knew that
// `properties.notes` was thinking-space and `body` was the artifact, and nothing
// else did.
//
// That gap is what this type closes. The API returned the surfaces all along
// (GET /api/items/[id] hands back `properties` wholesale), and MCP did too
// (rowView passes `properties` through), but neither NAMED them, so a caller had
// an untyped blob and no way to tell a paper's draft from its notes. Asked to
// "add my notes to this paper", an agent appended to the draft — the one surface
// that is the deliverable.
//
// Declaring them here rather than in each reader keeps one source of truth: the
// registry already owns a type's code behavior (canvas, canonical format,
// exporters), so surfaces sit beside those and every consumer — MCP, the REST
// API, and later the exporters — resolves the same list.
export type SurfaceStorage =
  // The item's canonical body column.
  | { kind: "body" }
  // A key under items.properties.
  | { kind: "property"; key: string }
  // No storage of its own: a projection over other surfaces (a paper's Outline
  // is its sections and quote bank rendered together). Read-only by definition —
  // a writer edits the surfaces it derives from.
  | { kind: "derived"; from: string[] };

export type SurfaceDef = {
  // Stable slug, unique within the type. The id a caller names on read/write.
  id: string;
  // What the canvas calls this surface, so an agent's language matches the UI's.
  label: string;
  storage: SurfaceStorage;
  // The content format: a body-format string ("markdown", "chordpro") for prose
  // surfaces, or "json" for a structured one (a quote bank is an array of
  // objects, not text).
  format: string;
  // What belongs here, written for a model deciding where to put something. This
  // is the field that stops "add my notes" landing in the draft.
  description: string;
  // The finished artifact — the surface an export renders from. At most one per
  // type. A caller told to leave the artifact alone knows which one that is.
  primary?: boolean;
  // Structured or projected surfaces an agent should not free-write as text.
  readOnly?: boolean;
  // For a "json" surface: the shape of ONE element of the array, as
  // `key: description` pairs, with a `!` prefix marking a required key.
  //
  // This exists because of the 2026-09-16 incident: an agent filled a paper's
  // Shape and Quote Bank by GUESSING the element shape (`{title, body}` for a
  // section, `{quote, source, citation, note}` for a quote). Both guesses were
  // wrong, nothing rejected them, and the record became unopenable. Naming the
  // format and saying "these are structured" was not enough: a caller also needs
  // to know what one row LOOKS like. Descriptive, not enforcing — the enforcing
  // half is still owed (see next_steps.md).
  elements?: Record<string, string>;
};

// The surface every ordinary type has: its markdown body, and nothing else.
export function defaultSurfaces(format: string = MARKDOWN_FORMAT): SurfaceDef[] {
  return [
    {
      id: "body",
      label: "Body",
      storage: { kind: "body" },
      format,
      description: "The item's main content.",
      primary: true,
    },
  ];
}

// A type a module defines. `key` matches items.type and the types-table row the
// module seeds at install. `canonicalFormat` makes "more than one body format,
// keyed off type" a real platform capability (Tyler PR #1 decision #1) — markdown
// by default, a markdown-kin like "chordpro" per type. `canvasId` is the M5
// per-type-canvas policy. `label`/`icon` define the type for install; note the DB
// `types` table stays the runtime source for label/icon *enumeration*, while this
// registry owns the type's *code behavior* (canvas, format, exporters).
export type ModuleTypeDef = {
  key: string;
  label: string;
  canonicalFormat: string;
  canvasId: string;
  icon?: string;
  // The named places content lives on this type (ADR-260). Omit for the ordinary
  // single-body shape; `surfacesForType` falls back to `defaultSurfaces`.
  surfaces?: SurfaceDef[];
};

// An *attachable capability* (SPIKE — bespoke-tool catalog, next_steps.md:94).
// The decoupling at the heart of the catalog: a module's behavior (canvas,
// canonical format, exporters) named as a bundle that a user can attach to a
// type *they* create under their own key/label — so the chord chart isn't locked
// to the `song` key, and someone can make a "Worship Set" type that still gets
// the ChordPro canvas. `id` is the stable identifier a `types` row stores;
// `label`/`description`/`usage` are the catalog copy (what it does, how it can be
// used). The behavior fields mirror a ModuleTypeDef so resolution is identical
// whether a type *is* a module type or *borrows* one.
export type ModuleCapability = {
  id: string;
  label: string;
  description: string; // what it does
  usage: string; // how it can be used (the catalog's "for example…")
  canvasId: string;
  canonicalFormat: string;
  // Same as ModuleTypeDef.surfaces (ADR-260): a type that BORROWS this capability
  // gets these surfaces, so a user-named "Worship Set" carrying `chord-chart`
  // exposes the same Notes + Chart pair the `song` type does.
  surfaces?: SurfaceDef[];
  // A hidden capability still *resolves* (a type carrying it gets its canvas/
  // format) but is NOT offered in the Build "Bespoke tools" catalog — it isn't
  // something the user picks. Used by `widget-home`, which is now the automatic
  // default for custom types (set at create, resolved by carrying the id), not a
  // pickable tool. `allCapabilities` includes hidden ones; `attachableCapabilities`
  // (the catalog) filters them out.
  hidden?: boolean;
};

// A module: a workflow packaged as a unit (Tyler PR #1 §1). Mostly assembled from
// machinery Ledgr already has (typed items, properties, relations, FTS, export);
// the only new platform pieces are the per-type canvas (M5) and this registration
// boundary (M6). `capabilities` (SPIKE) are the behaviors this module offers up
// for attachment to user-named types via the Build catalog.
export type ModuleManifest = {
  id: string;
  label: string;
  // One plain sentence for the Build → Modules page: what turning this on gives
  // the owner. Optional; core has none because it is never listed.
  description?: string;
  // Whether the module is on for an instance by default. The owner's switch on
  // /build/modules (settings.modules, ADR-272) overrides it; `isModuleEnabled`
  // answers with the switch when set and this default otherwise.
  enabledByDefault: boolean;
  types: ModuleTypeDef[];
  exporters: ExporterDef[];
  integration?: IntegrationDef;
  capabilities?: ModuleCapability[];
  // --- contribution slots: hooks and jobs (ADR-272 step 3) ---
  // Code a module runs when core writes an item, so core never imports the
  // module by name. Runs only while the module is on for the owner.
  hooks?: ModuleHooks;
  // --- contribution slots: tools and health (ADR-272 step 3) ---
  // The MCP tools this module owns, by name. They are listed and callable only
  // while the module is on for the owner; a tool no module claims is core and
  // always on. `instructions` is the block the MCP server appends to its
  // connect-time instructions while the module is on.
  // `tools` holds the definitions themselves (step 4). A tool reaches the
  // database, so it is never written on the pure manifest: the module's
  // server.ts attaches it, and the MCP registry collects it from there.
  mcpTools?: { names: string[]; instructions?: string; tools?: McpTool[] };
  // MCP resources this module serves (step 4), listed and readable only while
  // it is on. Server-filled by the module's server.ts, like `mcpTools.tools`.
  mcpResources?: McpResourceDef[];
  // Filters and annotates core's search_items hits (step 4), so a module can
  // drop or mark its own rows without the core tool importing it. Runs only
  // while the module is on. Server-filled by the module's server.ts.
  mcpSearchHits?: (ownerId: string, hits: McpSearchHit[]) => Promise<McpSearchHit[]>;
  // The module's own canaries for /health, reported under the module id. Runs
  // only while the module is on for the instance owner. Keep it cheap; a throw
  // is caught and reported for that module alone.
  healthCheck?: (ownerId: string) => Promise<Record<string, unknown>>;
  // --- contribution slots (ADR-272 step 3) ---
  // Build sidebar entries this module adds. Each lands in `group`, right after
  // the core entry whose href is `after`, else at the end of the group. Only an
  // enabled module's entries show in the sidebar and the destination picker
  // (build-nav.ts `buildNavFor`). `icon` is a nav-icons key.
  nav?: {
    group: "DATA" | "INTERFACE" | "MAINTAIN" | "SYSTEM";
    label: string;
    href: string;
    icon: string;
    after?: string;
    keywords?: string[];
  }[];
  // Path patterns (createRouteMatcher syntax) that must bypass sign-in, such as
  // a signed webhook or a token-credentialed feed. proxy.ts appends every
  // registered module's list, on or off: see `modulePublicPaths`.
  publicPaths?: string[];
  // Module ids this module cannot run without. isModuleEnabled does NOT enforce
  // it; the Modules page and PATCH /api/settings do, via `requiresViolations`.
  requires?: string[];
  // Whether THIS machine can run the module at all, separate from the owner's
  // switch (the agent needs a local hub's Claude login, ADR-271). Pure: reads
  // the environment only. Absent means always available. The root layout's
  // shell panels, the Modules page and the module's own routes read it.
  available?: () => boolean;
  // --- step 4: where the module's route files live ---
  routes?: string[]; // src/app paths owned by this module
};

// An MCP resource a module serves: the resources/list descriptor plus a reader.
export type McpResourceDef = {
  uri: string;
  name: string;
  title?: string;
  description: string;
  mimeType: string;
  read: () => string;
};

// A search_items hit; `extra` is merged into the tool's row for that hit.
export type McpSearchHit = SearchResult & { extra?: Record<string, unknown> };

// --- core as the first module ----------------------------------------------

// The five system types (schema.md / scripts/seed.mjs). All markdown-canonical
// today; only `link` declares a bespoke canvas (the URL chip, ADR-041).
// Registering core as a module means the whole app resolves type behavior
// through this one boundary, and the default markdown experience is unchanged.
export const coreModule: ModuleManifest = {
  id: "core",
  label: "Core",
  enabledByDefault: true,
  types: [
    { key: "task", label: "Task", icon: "check-square", canonicalFormat: MARKDOWN_FORMAT, canvasId: "task" },
    { key: "event", label: "Event", icon: "users", canonicalFormat: MARKDOWN_FORMAT, canvasId: "event" },
    { key: "note", label: "Note", icon: "file-text", canonicalFormat: MARKDOWN_FORMAT, canvasId: "longform" },
    { key: "link", label: "Link", icon: "link", canonicalFormat: MARKDOWN_FORMAT, canvasId: "longform" },
    { key: "person", label: "Person", icon: "user", canonicalFormat: MARKDOWN_FORMAT, canvasId: DEFAULT_CANVAS },
  ],
  exporters: [],
  // Canvas tabs (ADR-095): a default-canvas behavior, not a separate canvas
  // (canvasId stays the default markdown canvas — MarkdownCanvas turns tabs on
  // when a type carries this capability). Auto-on for `note`; attach to any
  // other type from the Build bespoke-tool catalog. Tabs are sections of the
  // same markdown body, so the canonical format is unchanged.
  capabilities: [
    {
      // Longform document canvas (ADR-157): the body is the star, with a compact
      // metadata byline under the title. Its canvas (LongformCanvas) enables tabs
      // itself, so a type that wants both a document layout and tabs attaches this
      // one capability (the single-capability slot can't hold "tabs" as well).
      id: "longform",
      label: "Longform document",
      description: "A document-shaped canvas: the markdown body runs the full width, with a compact metadata byline under the title.",
      usage:
        "Best for prose types you mostly write body text in — journals, prayers, meeting or email notes, transcripts, teachings — where a few fields belong quietly at the top, not in a side panel.",
      canvasId: "longform",
      canonicalFormat: MARKDOWN_FORMAT,
    },
    {
      id: "tabs",
      label: "Tabs",
      description: "Split the canvas into named tabs, each a section of the same note.",
      usage:
        "Keep related-but-separate content apart on one item — e.g. several lyric versions plus notes on one song's note, or research vs. draft on a paper.",
      canvasId: DEFAULT_CANVAS,
      canonicalFormat: MARKDOWN_FORMAT,
    },
    {
      // Widget-composed homepage (Project Type, ADR-111). A type carrying this
      // capability renders its records through the widget canvas — a set of
      // widgets bound to the record (PRD §0). The body stays markdown (the
      // Overview widget renders it), so the canonical format is unchanged.
      //
      // `hidden`: not a pickable "bespoke tool" — the Build catalog doesn't
      // offer it. Since ADR-204 it is an EXPLICIT OPT-IN, not the silent
      // default it was from 2026-07-01: TypeBuilder's "Project-style page"
      // checkbox writes it (a new custom type without the checkbox gets the
      // plain document canvas). It stays a resolvable capability so the types
      // that carry it (custom types that opted in, Project, Pursuit) still
      // route to the widget canvas.
      id: "widget-home",
      label: "Widget homepage",
      description: "Compose this type's page from widgets (tasks, notes, milestones, progress, …) bound to the record.",
      usage:
        "Turn a type into a hub: a Project shows its tasks, notes, meetings, milestones, progress and next action on one composable page. Arrange and toggle widgets per record.",
      canvasId: "widgets",
      canonicalFormat: MARKDOWN_FORMAT,
      hidden: true,
    },
  ],
};

// --- the registry ----------------------------------------------------------

// Core is always present. A workflow module appends via `registerModule` (and,
// once per-user enable lands, is seeded per instance). The live app ships
// core-only: `referenceModule` (below) is a worked example the M6 verify script
// registers to prove a second module slots in — the foundation delivers the
// *capability*, not the modules (ADR-042).
const BUILTIN_MODULES: ModuleManifest[] = [coreModule];
const registered: ModuleManifest[] = [];

export function registerModule(manifest: ModuleManifest): void {
  if (allModules().some((m) => m.id === manifest.id)) {
    throw new Error(`module "${manifest.id}" is already registered`);
  }
  registered.push(manifest);
}

export function allModules(): ModuleManifest[] {
  return [...BUILTIN_MODULES, ...registered];
}

// The per-owner enable switch (ADR-272 step 1). The owner's choice lives in
// settings.modules, which is in the database, and this file must stay pure (no
// DB, no React; see the header). So the choice arrives through an injection
// seam: the impure side (`src/lib/modules/enabled.ts`) installs a resolver that
// reads the owner's settings, preloaded once per request. The resolver answers
// true/false when the owner has flipped the switch and undefined when it has
// nothing to say (no owner, not preloaded, never touched), in which case the
// manifest default wins. It must never throw. A plain-node verify script can
// install a fake one. Core is always on: it is the frame the rest registers onto.
// A type whose module is off resolves to the default canvas, contributes no
// exporters, and reports no canonical format override.
export type ModuleEnabledResolver = (
  moduleId: string,
  ownerId?: string
) => boolean | undefined;

let resolver: ModuleEnabledResolver = () => undefined;

export function setModuleEnabledResolver(fn: ModuleEnabledResolver): void {
  resolver = fn;
}

export function isModuleEnabled(moduleId: string, ownerId?: string): boolean {
  if (moduleId === coreModule.id) return true;
  const m = allModules().find((x) => x.id === moduleId);
  if (!m) return false;
  return resolver(moduleId, ownerId) ?? m.enabledByDefault;
}

// The type keys whose module is switched off, given an owner's settings.modules
// map. The async paths (listTypes, quick capture, MCP) read settings directly
// and call this, so they never depend on the per-request preload. Core types are
// never in it.
export function typeKeysOfDisabledModules(flags: Record<string, boolean>): string[] {
  return allModules()
    .filter((m) => m.id !== coreModule.id && (flags[m.id] ?? m.enabledByDefault) === false)
    .flatMap((m) => m.types.map((t) => t.key));
}

function enabledModules(ownerId?: string): ModuleManifest[] {
  return allModules().filter((m) => isModuleEnabled(m.id, ownerId));
}

// --- resolvers (pure; the boundary core dispatches through) ----------------

// Which module owns a type (the first enabled module that declares it).
export function moduleForType(
  type: string,
  ownerId?: string
): ModuleManifest | undefined {
  return enabledModules(ownerId).find((m) =>
    m.types.some((t) => t.key === type)
  );
}

export function typeDefFor(
  type: string,
  ownerId?: string
): ModuleTypeDef | undefined {
  for (const m of enabledModules(ownerId)) {
    const def = m.types.find((t) => t.key === type);
    if (def) return def;
  }
  return undefined;
}

// --- attachable capabilities (SPIKE — bespoke-tool catalog) ----------------

// Every capability an enabled module exposes, hidden ones included — the
// resolution source (`capabilityById` reads this so a type carrying a hidden
// capability like `widget-home` still routes to its canvas). Capabilities a
// disabled module exposes drop out, like its types do.
export function allCapabilities(
  ownerId?: string
): (ModuleCapability & { moduleId: string })[] {
  return enabledModules(ownerId).flatMap((m) =>
    (m.capabilities ?? []).map((c) => ({ ...c, moduleId: m.id }))
  );
}

// The capabilities offered for attachment in the Build "Bespoke tools" catalog —
// `allCapabilities` minus the hidden ones (a hidden capability resolves but isn't
// something the user picks; see `widget-home`).
export function attachableCapabilities(
  ownerId?: string
): (ModuleCapability & { moduleId: string })[] {
  return allCapabilities(ownerId).filter((c) => !c.hidden);
}

// Resolve a capability id to its bundle (+ owning module), or undefined if no
// enabled module offers it (e.g. the module was disabled after a type attached
// it — the type then degrades to the default canvas, exactly like a disabled
// module's own type). Reads `allCapabilities` so hidden capabilities still
// resolve for the types that carry them.
export function capabilityById(
  id: string,
  ownerId?: string
): (ModuleCapability & { moduleId: string }) | undefined {
  return allCapabilities(ownerId).find((c) => c.id === id);
}

// --- capability-aware behavior resolution ----------------------------------
//
// SPIKE: each resolver takes an optional `capability` — the id a user-created
// `types` row stored when it attached a bespoke tool. A registered module type
// (its key matches) always wins; otherwise an attached capability resolves the
// behavior; otherwise the default. This is the whole decoupling: behavior is no
// longer pinned to the type key.

// The per-type canvas policy (M5). An unknown type, or one whose module is
// disabled, falls back to the default markdown canvas — unless it borrows a
// capability, which supplies the canvas instead.
export function canvasIdForType(
  type: string,
  ownerId?: string,
  capability?: string | null
): string {
  const def = typeDefFor(type, ownerId);
  if (def) return def.canvasId;
  if (capability) {
    const cap = capabilityById(capability, ownerId);
    if (cap) return cap.canvasId;
  }
  return DEFAULT_CANVAS;
}

// The canonical body format for a type — markdown unless the owning type declares
// otherwise (e.g. ChordPro for Songs), or unless it borrows a capability that
// does. The body contract (`src/lib/body.ts`) already stores `{format, text}`;
// this is where a renderer/editor asks "which format is canonical for this type."
export function canonicalFormatForType(
  type: string,
  ownerId?: string,
  capability?: string | null
): string {
  const def = typeDefFor(type, ownerId);
  if (def) return def.canonicalFormat;
  if (capability) {
    const cap = capabilityById(capability, ownerId);
    if (cap) return cap.canonicalFormat;
  }
  return MARKDOWN_FORMAT;
}

// The named surfaces a type exposes (ADR-260). Same resolution order as every
// resolver above — a registered module type wins, then an attached capability,
// then the default — so a user-named type borrowing `paper-workspace` reports
// the paper's five surfaces, and an ordinary type reports its single body. The
// fallback threads the type's canonical format through, so a chordpro type with
// no declared surfaces still says "body, chordpro" rather than claiming markdown.
export function surfacesForType(
  type: string,
  ownerId?: string,
  capability?: string | null
): SurfaceDef[] {
  const def = typeDefFor(type, ownerId);
  if (def) return def.surfaces ?? defaultSurfaces(def.canonicalFormat);
  if (capability) {
    const cap = capabilityById(capability, ownerId);
    if (cap) return cap.surfaces ?? defaultSurfaces(cap.canonicalFormat);
  }
  return defaultSurfaces();
}

// One surface by id, or undefined. The lookup a write path uses to turn
// `surface: "notes"` into "merge properties.notes".
export function surfaceById(
  type: string,
  surfaceId: string,
  ownerId?: string,
  capability?: string | null
): SurfaceDef | undefined {
  return surfacesForType(type, ownerId, capability).find((s) => s.id === surfaceId);
}

// The deterministic exporters a type offers (markdown→docx, ChordPro→chart). A
// type that borrows a capability inherits its module's exporters, re-pointed at
// this type key (the exporter's `render` is key-agnostic — it reads the body),
// so a "Worship Set" gets the song module's "Copy for Planning Center" exporter.
export function exportersForType(
  type: string,
  ownerId?: string,
  capability?: string | null
): ExporterDef[] {
  const own = enabledModules(ownerId).flatMap((m) =>
    m.exporters.filter((e) => e.forType === type)
  );
  if (own.length > 0 || !capability) return own;
  const cap = capabilityById(capability, ownerId);
  if (!cap) return [];
  const owner = allModules().find((m) => m.id === cap.moduleId);
  return (owner?.exporters ?? []).map((e) => ({ ...e, forType: type }));
}

// Every type key contributed by an enabled module — the seam a future Build
// surface / quick-capture list reads from (today the UI enumerates the DB `types`
// table; this is its code-side counterpart).
export function registeredTypeKeys(ownerId?: string): string[] {
  return enabledModules(ownerId).flatMap((m) => m.types.map((t) => t.key));
}

// --- reference module (worked example; NOT registered in the live app) ------

// A minimal module touching all four slots — a type with its own canonical
// format and canvas, an exporter, and an integration — kept as executable
// documentation of the contract and as the fixture the M6 verify script
// registers to prove a workflow module slots in. It is deliberately NOT in
// BUILTIN_MODULES, so it never affects the running app (no DB `types` row exists
// for it either); per ADR-042 the foundation ships the capability, not modules.
// Real modules (Papers → markdown/docx + quote bank, Songs → ChordPro/chart +
// PCO) follow this exact shape in their own files.
export const referenceModule: ModuleManifest = {
  id: "reference",
  label: "Reference (example module)",
  enabledByDefault: true,
  types: [
    {
      key: "reference",
      label: "Reference Item",
      canonicalFormat: MARKDOWN_FORMAT,
      canvasId: "reference-canvas",
    },
  ],
  exporters: [
    {
      id: "reference-text",
      label: "Plain text",
      forType: "reference",
      fileExtension: "txt",
      // Deterministic, no model: the body's text, verbatim. Stands in for a real
      // module's markdown→docx / ChordPro→chart render.
      render: (body) => body.text,
    },
  ],
  integration: {
    id: "reference-pull",
    label: "Reference source",
    direction: "pull",
  },
};

// --- save hooks (ADR-272 step 3.6) -----------------------------------------
//
// What a module runs when core writes an item, so item-mutations.ts calls one
// runner instead of importing each module (passages, YouTube) by name. Only the
// types and the pure lookup live here; the runner that reads the owner's
// switches and catches each hook's failure is `src/lib/modules/hooks.ts`. A
// hook loads anything heavy with `await import(...)`, because manifests sit on
// the pure path that verify scripts and client pages import.
export type HookContext = {
  ownerId: string;
  itemId: string;
  // Set on create. A body save does not know the type.
  type?: string;
  // The saved body on a body save; null when the body was cleared.
  body?: unknown;
  url?: string | null;
  // The executor to write through when the caller holds a transaction (the
  // sync apply path), so derived rows commit with the row. Absent: use getDb().
  db?: { execute(query: unknown): Promise<unknown> };
};

export type HookFn = (ctx: HookContext) => Promise<void>;

export type ModuleHooks = {
  // After a body is written (create or update). Awaited inline, after the
  // revision snapshot and the mention edges. Runs on a cleared body too.
  onBodySave?: HookFn;
  // After an item is created. Fire and forget: the caller's reply never waits.
  onCreate?: HookFn;
};

export type HookName = keyof ModuleHooks;

// The hooks of this name from every module `isOn` says is on, in registration
// order. Pure: the caller decides what "on" means (the owner's switches, or a
// fixture in a verify script).
export function hooksFor(
  name: HookName,
  isOn: (moduleId: string) => boolean
): { moduleId: string; run: HookFn }[] {
  return allModules().flatMap((m) => {
    const run = m.hooks?.[name];
    return run && isOn(m.id) ? [{ moduleId: m.id, run }] : [];
  });
}

// --- contribution slots: tools and health (ADR-272 step 3) ------------------

// The module that claims an MCP tool, or undefined for a core tool.
export function moduleOwningTool(name: string): ModuleManifest | undefined {
  return allModules().find((m) => m.mcpTools?.names.includes(name));
}

// Whether a tool is available, given "is this module on for the owner". Pure:
// the MCP registry passes `moduleOn` over the owner's settings, a verify script
// passes a fake. A tool no module claims is core, so always on.
export function toolEnabledFor(name: string, isOn: (moduleId: string) => boolean): boolean {
  const m = moduleOwningTool(name);
  return !m || isOn(m.id);
}

// The MCP instruction blocks of every module that is on, in registration order.
export function moduleInstructions(isOn: (moduleId: string) => boolean): string[] {
  return allModules().flatMap((m) =>
    m.mcpTools?.instructions && isOn(m.id) ? [m.mcpTools.instructions] : []
  );
}

// The MCP resources of every module that is on, in registration order.
export function moduleResources(isOn: (moduleId: string) => boolean): McpResourceDef[] {
  return allModules().flatMap((m) => (m.mcpResources && isOn(m.id) ? m.mcpResources : []));
}

// --- contribution-slot resolvers (ADR-272 step 3) ---------------------------

export type ModuleNavEntry = NonNullable<ModuleManifest["nav"]>[number] & {
  moduleId: string;
};

// Every registered module's Build sidebar entries, minus those of the modules
// in `off`. It takes the off list rather than an owner id so the client sidebar
// can call it with the ids the server already worked out (`offModuleIds`): the
// per-request resolver behind isModuleEnabled does not exist in the browser.
// With no list it returns every registered module's entries, which is what the
// command palette and describe_workspace index.
export function navEntriesForModules(off: readonly string[] = []): ModuleNavEntry[] {
  return allModules()
    .filter((m) => !off.includes(m.id))
    .flatMap((m) => (m.nav ?? []).map((e) => ({ ...e, moduleId: m.id })));
}

// Every registered module's public paths, ENABLED OR NOT. proxy.ts runs before
// auth on every request and must stay fast, so it never reads the owner's
// settings: a disabled module's public route stays reachable past sign-in and
// is refused by the route itself (plan step 4's shared guard).
export function modulePublicPaths(): string[] {
  return allModules().flatMap((m) => m.publicPaths ?? []);
}

// Whether this machine can run the module (the manifest's `available`, else yes).
export function moduleAvailable(moduleId: string): boolean {
  return allModules().find((m) => m.id === moduleId)?.available?.() ?? true;
}

export type RequiresViolation = {
  moduleId: string;
  requires: string;
  message: string;
};

// Every enabled module whose requirement is off, given an owner's
// settings.modules map (a missing entry follows the manifest default, core is
// always on, an unregistered requirement counts as off). Empty means the map is
// consistent. The Modules page and PATCH /api/settings both call it.
export function requiresViolations(flags: Record<string, boolean>): RequiresViolation[] {
  const byId = new Map(allModules().map((m) => [m.id, m]));
  const on = (id: string): boolean => {
    if (id === coreModule.id) return true;
    const m = byId.get(id);
    return !!m && (flags[id] ?? m.enabledByDefault);
  };
  return allModules()
    .filter((m) => on(m.id))
    .flatMap((m) =>
      (m.requires ?? [])
        .filter((r) => !on(r))
        .map((r) => {
          const req = byId.get(r)?.label ?? r;
          return {
            moduleId: m.id,
            requires: r,
            message: `${m.label} needs ${req}. Turn ${req} on, or turn ${m.label} off first.`,
          };
        })
    );
}

// Everything a module needs, directly or through another requirement (the
// module itself excluded). The Modules page turns these on alongside it.
export function requirementsOf(moduleId: string): string[] {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const r of allModules().find((m) => m.id === id)?.requires ?? []) {
      if (r !== moduleId && !out.has(r)) {
        out.add(r);
        walk(r);
      }
    }
  };
  walk(moduleId);
  return [...out];
}
