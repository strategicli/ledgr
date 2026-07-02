// Workspace-shaping tools (ADR-102): describe_workspace is the
// read-before-write orientation snapshot; update_nav shapes the Work
// navigation. Both are thin wrappers over the same owner-scoped libs the
// Build REST routes use.
import { listDashboards } from "@/lib/dashboards";
import { ItemError } from "@/lib/items";
import { BUILD_NAV } from "@/lib/build-nav";
import {
  NAV_DENSITIES,
  NAV_POSITIONS,
  RAIL_ANCHORS,
  RAIL_SIZES,
  getSettings,
  updateSettings,
  type NavSlotConfig,
  type UserSettings,
} from "@/lib/settings";
import { listTypes } from "@/lib/types";
import { listViews } from "@/lib/views";
import { optEnum } from "./args";
import { dashView, navView } from "./serializers";
import type { McpTool } from "./wire";

export const workspaceTools: McpTool[] = [
  {
    name: "describe_workspace",
    title: "Describe workspace",
    description:
      "Read-before-write orientation: a compact snapshot of the owner's whole " +
      "workspace so you can shape it correctly. Returns the types (key, label, " +
      "property count), saved views (id, name, layout), dashboards (id, name, and " +
      "a short widget list), the navigation (layout knobs + the configurable " +
      "slots + the assigned home/today dashboards), and the catalog of Build " +
      "tools a nav slot can point at. These are summaries — call list_types for a " +
      "type's full property schema, or list_views for a view's full filter/sort. " +
      "Call this first, then create_type / create_view / create_dashboard / " +
      "add_widget / update_nav to make changes. Read the 'workspace-shaping-guide' " +
      "resource for how the pieces fit together.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId) => {
      const [typeDefs, viewDefs, dashboardDefs, settings] = await Promise.all([
        listTypes({ includeHidden: true }),
        listViews(ownerId),
        listDashboards(ownerId),
        getSettings(ownerId),
      ]);
      return {
        types: typeDefs.map((t) => ({
          key: t.key,
          label: t.label,
          isSystem: t.isSystem,
          hidden: t.hidden,
          propertyCount: t.propertySchema.length,
          ...(t.capability ? { capability: t.capability } : {}),
        })),
        views: viewDefs.map((v) => ({
          id: v.id,
          name: v.name,
          isSystem: v.isSystem,
          layout: v.layout,
        })),
        dashboards: dashboardDefs.map(dashView),
        nav: navView(settings),
        // The hardcoded Build sidebar (build-nav.ts) — the destinations a Work
        // nav slot can point at (a "Clean" button → Data Hygiene, etc.).
        buildTools: BUILD_NAV.flatMap((g) =>
          g.entries.map((e) => ({ group: g.label, label: e.label, href: e.href }))
        ),
      };
    },
  },
  {
    name: "update_nav",
    title: "Update navigation",
    description:
      "Shape the Work navigation — the owner's main toolbar. Set `navSlots` (the " +
      "configurable middle slots; a locked Home/New/More are added " +
      "automatically) and/or the layout knobs `position` (top|bottom|left|right), " +
      "`railSize` (fat|thin|hidden), `density` (spread|compact), `railAnchor` " +
      "(top|bottom|center). A slot is either { type:'destination', kind, href, " +
      "label, icon } (kind builtin|view|type|dashboard; href like /tasks, " +
      "/views/<id>, /list/<key>) or { type:'tools', label, icon, " +
      "children:[destinations] }. `mobileNavSlots` is a separate phone list (null " +
      "mirrors desktop). Read the current nav via describe_workspace first, keep " +
      "it to ~4–5 slots, and confirm with the owner. Only the fields you pass " +
      "change; passing navSlots replaces the whole middle-slot list.",
    inputSchema: {
      type: "object",
      properties: {
        navSlots: { type: "array", description: "The full ordered middle-slot list (replaces the current one). See the description for the slot shape.", items: { type: "object" } },
        mobileNavSlots: { type: "array", description: "A distinct phone slot list, or null to mirror desktop.", items: { type: "object" } },
        position: { type: "string", enum: [...NAV_POSITIONS], description: "Nav position: top | bottom | left | right." },
        railSize: { type: "string", enum: [...RAIL_SIZES], description: "Side-rail width: fat | thin | hidden." },
        density: { type: "string", enum: [...NAV_DENSITIES], description: "Packing: spread | compact." },
        railAnchor: { type: "string", enum: [...RAIL_ANCHORS], description: "Cluster anchor for a compact rail/top bar: top | bottom | center." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const patch: Partial<UserSettings> = {};
      if (args.navSlots !== undefined) {
        if (!Array.isArray(args.navSlots)) {
          throw new ItemError("bad_request", "navSlots must be an array");
        }
        patch.navSlots = args.navSlots as NavSlotConfig[];
      }
      if (args.mobileNavSlots !== undefined) {
        if (args.mobileNavSlots !== null && !Array.isArray(args.mobileNavSlots)) {
          throw new ItemError("bad_request", "mobileNavSlots must be an array or null");
        }
        patch.mobileNavSlots = args.mobileNavSlots as NavSlotConfig[] | null;
      }
      const position = optEnum(args, "position", NAV_POSITIONS);
      if (position) patch.navPosition = position;
      const railSize = optEnum(args, "railSize", RAIL_SIZES);
      if (railSize) patch.railSize = railSize;
      const density = optEnum(args, "density", NAV_DENSITIES);
      if (density) patch.navDensity = density;
      const railAnchor = optEnum(args, "railAnchor", RAIL_ANCHORS);
      if (railAnchor) patch.railAnchor = railAnchor;
      if (Object.keys(patch).length === 0) {
        throw new ItemError("bad_request", "pass at least one nav field to change");
      }
      const settings = await updateSettings(ownerId, patch);
      return navView(settings);
    },
  },
];
