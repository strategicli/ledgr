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
  SEARCH_MODES,
  getSettings,
  updateSettings,
  type NavSlotConfig,
  type UserSettings,
} from "@/lib/settings";
import { getType, listTypes } from "@/lib/types";
import { listViews } from "@/lib/views";
import {
  defaultLenses,
  lensesForType,
  parseLenses,
  type Lens,
} from "@/lib/list-lenses";
import { optEnum, reqString } from "./args";
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
        // Per-type list-page tab strips the owner has customized, as labels only
        // (set_list_tabs reads one type's full strip). A type that isn't listed
        // is on the virtual defaults, which is most of them.
        listTabs: Object.fromEntries(
          Object.entries(settings.listTabs ?? {})
            .filter(([, lenses]) => lenses.length > 0)
            .map(([key, lenses]) => [key, lenses.map((l) => l.label)])
        ),
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
      "(top|bottom|center), `searchMode` (what the Search icon opens: palette = " +
      "the quick ⌘K popup, page = the full search page). A slot is either " +
      "{ type:'destination', kind, href, " +
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
        searchMode: { type: "string", enum: [...SEARCH_MODES], description: "What the nav's one Search icon opens: palette (the quick ⌘K popup) | page (the full search page). ⌘K opens the popup either way." },
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
      const searchMode = optEnum(args, "searchMode", SEARCH_MODES);
      if (searchMode) patch.searchMode = searchMode;
      if (Object.keys(patch).length === 0) {
        throw new ItemError("bad_request", "pass at least one nav field to change");
      }
      const settings = await updateSettings(ownerId, patch);
      return navView(settings);
    },
  },
  {
    name: "set_list_tabs",
    title: "Set a type's list tabs",
    description:
      "Shape the TAB STRIP across the top of a type's list page (/list/<key>) — " +
      "the lenses the owner switches between. Every type gets four virtual " +
      "defaults for free (Recent, Newest, A → Z, Most linked; projects also lead " +
      "with Board and close with Completed), and this replaces that strip with " +
      "your own. Call it with only `typeKey` to READ the current strip before " +
      "changing it, since a write replaces the whole list. A tab is one of: " +
      "{ kind: 'view', viewId } to render a saved view as a tab (the way to put " +
      "a filtered board or list on the type's page — create_view first and pass " +
      "its id); { kind: 'sort', source: { field } | { property }, dir } for the " +
      "plain item list in an order, where field is updatedAt | createdAt | title " +
      "| mostLinked | urgency; or { kind: 'board' } / { kind: 'completed' } (the " +
      "type's own status kanban and its finished-work archive) and, on events, " +
      "{ kind: 'calendar' } / { kind: 'timeline' }. Each tab takes a `label` " +
      "(defaults to the view's name for a view tab) and an optional `id`. Max 12 " +
      "per type. Pass reset:true to drop your strip and go back to the defaults.",
    inputSchema: {
      type: "object",
      properties: {
        typeKey: { type: "string", description: "The type whose list page this is, e.g. 'project' (see list_types)." },
        tabs: {
          type: "array",
          description: "The full ordered tab strip (replaces the current one). Omit to READ the current strip; see the description for the per-tab shape.",
          items: { type: "object" },
        },
        reset: { type: "boolean", description: "true = drop the custom strip and go back to the virtual defaults." },
      },
      required: ["typeKey"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const typeKey = reqString(args, "typeKey").toLowerCase();
      // A strip stored for a type that doesn't exist is invisible dead config.
      await getType(typeKey);
      const settings = await getSettings(ownerId);

      // Read: neither tabs nor reset. The effective strip, so a caller editing
      // one tab can resend the rest instead of guessing the defaults.
      if (args.tabs === undefined && args.reset !== true) {
        return {
          typeKey,
          tabs: lensesForType(settings, typeKey),
          isDefault: !settings.listTabs?.[typeKey]?.length,
        };
      }

      if (args.reset === true) {
        const listTabs = { ...settings.listTabs };
        delete listTabs[typeKey];
        await updateSettings(ownerId, { listTabs });
        return { typeKey, tabs: defaultLenses(typeKey), isDefault: true, reset: true };
      }

      if (!Array.isArray(args.tabs)) throw new ItemError("bad_request", "tabs must be an array");
      if (args.tabs.length === 0) {
        throw new ItemError(
          "bad_request",
          "tabs is empty — pass reset:true to go back to the default strip"
        );
      }

      // Normalize BEFORE parseLenses. parseLenses is the settings validator and
      // silently drops a malformed entry (right for a stored blob, wrong for a
      // tool call: the tab would just never appear and nothing would say why).
      // So fill in what's derivable — a view tab's label from the view's name,
      // an id from the label — and refuse what isn't, by name.
      const views = await listViews(ownerId);
      const byId = new Map(views.map((v) => [v.id, v]));
      const usedIds = new Set<string>();
      const normalized = args.tabs.map((raw, i) => {
        const at = `tabs[${i}]`;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new ItemError("bad_request", `${at} must be an object`);
        }
        const t = { ...(raw as Record<string, unknown>) };
        if (t.kind === "view") {
          const viewId = typeof t.viewId === "string" ? t.viewId.trim() : "";
          const view = byId.get(viewId);
          if (!view) {
            throw new ItemError(
              "bad_request",
              `${at}.viewId "${viewId}" is not one of this owner's saved views ` +
                `(${views.map((v) => `${v.name} = ${v.id}`).join("; ") || "none exist yet"})`
            );
          }
          t.viewId = viewId;
          if (typeof t.label !== "string" || !t.label.trim()) t.label = view.name;
        }
        const label = typeof t.label === "string" ? t.label.trim() : "";
        if (!label) throw new ItemError("bad_request", `${at}.label is required`);
        // Ids are opaque and only have to be unique within the strip, so derive
        // one from the label rather than making the caller invent it.
        let id = typeof t.id === "string" && t.id.trim() ? t.id.trim() : "";
        if (!id) {
          id =
            label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 40) || `tab-${i + 1}`;
        }
        if (usedIds.has(id)) {
          let n = 2;
          while (usedIds.has(`${id}-${n}`)) n += 1;
          id = `${id}-${n}`;
        }
        usedIds.add(id);
        return { ...t, id, label };
      });

      const lenses: Lens[] | null = parseLenses(normalized);
      if (!lenses) {
        throw new ItemError(
          "bad_request",
          "no valid tabs — a sort tab needs source { field } (updatedAt | " +
            "createdAt | title | mostLinked | urgency) or { property }, and a " +
            "view tab needs a viewId"
        );
      }
      const dropped = normalized.length - lenses.length;
      const listTabs = { ...settings.listTabs, [typeKey]: lenses };
      await updateSettings(ownerId, { listTabs });
      return {
        typeKey,
        tabs: lenses,
        isDefault: false,
        ...(dropped > 0
          ? { note: `${dropped} tab(s) were dropped as malformed — check their kind/source` }
          : {}),
      };
    },
  },
];
