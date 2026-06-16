// Workflow & wiki structure templates (slice 35, PRD §4.14): the guided "New
// Workflow" / "New Wiki" generators. A template is a *generator*, not a stored
// thing — its output is ordinary `types` + `views` rows (so "surface it / retire
// it" is just pinning/unpinning, and nothing new to clean up). The planning
// half is pure + deterministic (no model in the loop, Principle 3): it maps the
// guided answers to a type + properties + starter views via the §3.6 machinery,
// reusing parseTypeInput/parseViewInput so validation has one home. The apply
// half persists the plan over createType/createView and, when asked, adds the
// primary view to a dashboard (addViewToDefaultDashboard, dashboards epoch).
import { ItemError } from "@/lib/items";
import {
  parseTypeInput,
  type PropertyDef,
  type TypeCreateInput,
} from "@/lib/types";
import { createType } from "@/lib/types";
import { addViewToDefaultDashboard } from "@/lib/dashboards";
import { createView, parseViewInput, type ViewInput } from "@/lib/views";

export const STRUCTURE_KINDS = ["workflow", "wiki"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

// The stage select a workflow adds; the board groups by it. A fixed key so the
// generated board's grouping (`{ propertyKey: "stage" }`) and the type's
// property line up.
export const STAGE_KEY = "stage";

// What the guided form submits.
export type StructureInput = {
  kind: StructureKind;
  name: string;
  key?: string; // explicit type key; else slugified from the name
  stages?: string[]; // workflow only — the steps; becomes the "stage" select
  properties?: PropertyDef[]; // extra fields each record carries
  addToDashboard?: boolean; // pin the primary view as a Work widget
};

// A plan is a type + the views to create + which view is primary (the one to
// open after creation and pin if asked).
export type StructurePlan = {
  type: TypeCreateInput;
  views: ViewInput[];
  primaryViewName: string;
};

function bad(message: string): never {
  throw new ItemError("bad_request", message);
}

// Server-side slug, matching types.ts SLUG_RE (lowercase, starts with a
// letter). A leading non-letter gets a "t_" prefix so a digit-leading name
// still yields a valid key.
function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `t_${base}`;
}

function cleanProperties(raw: PropertyDef[] | undefined): PropertyDef[] {
  return (raw ?? []).filter((p) => p && p.label?.trim());
}

// Build the plan for one structure. Pure: deterministic, no DB, throws
// ItemError on bad input (so the API surfaces a 400). parse* do the real
// validation (key shape, kinds, select options, view layout).
export function planStructure(input: StructureInput): StructurePlan {
  const name = input.name?.trim();
  if (!name) bad("name is required");
  if (name.length > 80) bad("name too long (80 max)");
  const key = (input.key?.trim() || slugify(name)).toLowerCase();
  if (!key) bad("could not derive a key from the name; give one explicitly");

  if (input.kind === "workflow") return planWorkflow(name, key, input);
  if (input.kind === "wiki") return planWiki(name, key, input);
  bad("kind must be 'workflow' or 'wiki'");
}

// A workflow: a type whose records move through stages, plus a board grouped by
// that stage (the moving-through-stages view) and a table of every record.
function planWorkflow(
  name: string,
  key: string,
  input: StructureInput
): StructurePlan {
  const stages = (input.stages ?? []).map((s) => s.trim()).filter(Boolean);
  if (stages.length < 2) bad("a workflow needs at least two stages");

  // The stage select leads the schema, then the extra record fields.
  const stageProp: PropertyDef = {
    key: STAGE_KEY,
    label: "Stage",
    kind: "select",
    options: stages,
  };
  const extras = cleanProperties(input.properties).filter(
    (p) => p.key !== STAGE_KEY
  );

  const type = parseTypeInput(
    {
      key,
      label: name,
      icon: null,
      showInQuickCapture: true,
      propertySchema: [stageProp, ...extras],
    },
    "create"
  );

  const boardName = `${name} board`;
  const views: ViewInput[] = [
    parseViewInput({
      name: boardName,
      layout: "board",
      filter: { type: key },
      grouping: { propertyKey: STAGE_KEY },
      sort: { field: "updatedAt", dir: "desc" },
    }),
    parseViewInput({
      name: `All ${name}`,
      layout: "table",
      filter: { type: key },
      sort: { field: "updatedAt", dir: "desc" },
    }),
  ];

  return { type, views, primaryViewName: boardName };
}

// A wiki: a type for interconnected reference entries (relations via @-mentions
// on each entry's canvas), light on status — so the starter is a table of all
// entries, title-sorted. No stage/board.
function planWiki(
  name: string,
  key: string,
  input: StructureInput
): StructurePlan {
  const type = parseTypeInput(
    {
      key,
      label: name,
      icon: null,
      showInQuickCapture: true,
      propertySchema: cleanProperties(input.properties),
    },
    "create"
  );

  const tableName = `All ${name}`;
  const views: ViewInput[] = [
    parseViewInput({
      name: tableName,
      layout: "table",
      filter: { type: key },
      sort: { field: "title", dir: "asc" },
    }),
  ];

  return { type, views, primaryViewName: tableName };
}

export type StructureResult = {
  typeKey: string;
  viewIds: string[];
  primaryViewId: string | null;
  pinnedViewId: string | null;
};

// Persist a plan: create the type, then its views, then optionally pin the
// primary view to the dashboard (the "surface on Work" step — reuses the
// existing widget machinery, slice 29). Ownership is enforced by the view
// store; the type is instance-global (createType).
export async function applyStructurePlan(
  ownerId: string,
  plan: StructurePlan,
  opts: { addToDashboard?: boolean } = {}
): Promise<StructureResult> {
  await createType(plan.type); // throws bad_request on a duplicate key

  const created: { id: string; name: string }[] = [];
  for (const view of plan.views) {
    const v = await createView(ownerId, view);
    created.push({ id: v.id, name: v.name });
  }

  const primary = created.find((v) => v.name === plan.primaryViewName) ?? null;
  let pinnedViewId: string | null = null;
  if (opts.addToDashboard && primary) {
    // Dashboards epoch (ADR-064): add the generated primary view as a widget on
    // the owner's default dashboard (creating "Home" if they have none).
    await addViewToDefaultDashboard(ownerId, primary.id);
    pinnedViewId = primary.id;
  }

  return {
    typeKey: plan.type.key,
    viewIds: created.map((v) => v.id),
    primaryViewId: primary?.id ?? null,
    pinnedViewId,
  };
}

// --- Presets -------------------------------------------------------------
// The "small set of big, obvious starting buttons" (§4.14): named starting
// parameters the guided form prefills. Plain data — the form stays editable, so
// a preset is a head start, not a lock-in. "and the like" = these.
export type StructurePreset = {
  id: string;
  kind: StructureKind;
  label: string;
  description: string;
  name: string;
  stages?: string[];
  properties: PropertyDef[];
};

export const STRUCTURE_PRESETS: StructurePreset[] = [
  {
    id: "hiring",
    kind: "workflow",
    label: "Hiring pipeline",
    description: "Candidates moving from applied to hired.",
    name: "Hiring Candidate",
    stages: ["Applied", "Screen", "Interview", "Offer", "Hired", "Passed"],
    properties: [
      { key: "role", label: "Role", kind: "text" },
      { key: "resume", label: "Resume / profile", kind: "url" },
    ],
  },
  {
    id: "content",
    kind: "workflow",
    label: "Content pipeline",
    description: "Ideas through drafting, editing, and publishing.",
    name: "Content Piece",
    stages: ["Idea", "Drafting", "Editing", "Scheduled", "Published"],
    properties: [
      {
        key: "channel",
        label: "Channel",
        kind: "select",
        options: ["Sermon", "Blog", "Newsletter", "Social"],
      },
      { key: "publish_date", label: "Publish date", kind: "date" },
    ],
  },
  {
    id: "trips",
    kind: "wiki",
    label: "Trip archive",
    description: "Past and planned trips, cross-linked to people and places.",
    name: "Trip",
    properties: [
      { key: "location", label: "Location", kind: "text" },
      { key: "dates", label: "Dates", kind: "text" },
    ],
  },
  {
    id: "reading",
    kind: "wiki",
    label: "Reading list",
    description: "Books and articles, with notes written inside each entry.",
    name: "Reading",
    properties: [
      { key: "author", label: "Author", kind: "text" },
      { key: "link", label: "Link", kind: "url" },
    ],
  },
];

export function presetById(id: string): StructurePreset | undefined {
  return STRUCTURE_PRESETS.find((p) => p.id === id);
}
