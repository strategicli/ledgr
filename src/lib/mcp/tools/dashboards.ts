// Dashboard tools (ADR-047, ADR-102): create a dashboard and append widgets
// to it. Thin wrappers over the same parseDashboardInput/parseWidget the
// Build REST routes use.
import { asUuid } from "@/lib/api";
import {
  addWidget,
  createDashboard,
  parseDashboardInput,
  parseWidget,
} from "@/lib/dashboards";
import { ItemError } from "@/lib/items";
import { dashView } from "./serializers";
import type { McpTool } from "./wire";

// The widget kinds the MCP add_widget tool advertises. Pinned to the ADR-064/065
// base — the dashboard-canvas kinds (tree/embed/container, ADR-111) are UI-built
// and deliberately NOT on the machine/MCP contract (which is frozen-core), so
// this enum stays stable even as WIDGET_KINDS grows.
const MCP_WIDGET_KINDS = ["view", "stat", "action", "text"] as const;

export const dashboardTools: McpTool[] = [
  {
    name: "create_dashboard",
    title: "Create dashboard",
    description:
      "Create a dashboard — a named grid of widgets surfaced on Work. Optionally " +
      "pass `widgets` inline, or create it empty and add_widget afterward. A " +
      "`focusItemId` scopes every view widget to items related to that item (a " +
      "person/project dashboard). Widget shape: { kind, viewId?, settings?, " +
      "layout? } — see add_widget. Because view/stat widgets reference a saved " +
      "view, create the view first (create_view) and pass its id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Display name. E.g. 'Sermon prep'." },
        focusItemId: { type: "string", description: "Optional item id (UUID): scope every view widget to items related to it." },
        widgets: { type: "array", description: "Optional inline widgets (see add_widget for the shape). Malformed widgets are dropped.", items: { type: "object" } },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const created = await createDashboard(ownerId, parseDashboardInput(args));
      return dashView(created);
    },
  },
  {
    name: "add_widget",
    title: "Add dashboard widget",
    description:
      "Append a widget to a dashboard. `kind` is view (a live list from a saved " +
      "view — needs viewId), stat (a single count from a view — needs viewId), " +
      "action (a button — settings.action quick-capture|new-from-template|link), " +
      "or text (a heading/note — settings.heading/body). `settings` carries the " +
      "per-kind options (a view widget's titleOverride/renderStyle; an action's " +
      "label/targetType/href). Omit `layout` to let the widget auto-place on the " +
      "grid. Create the backing view (create_view) before adding a view/stat " +
      "widget.",
    inputSchema: {
      type: "object",
      properties: {
        dashboardId: { type: "string", description: "The dashboard id (UUID), from describe_workspace." },
        kind: { type: "string", enum: [...MCP_WIDGET_KINDS], description: "view | stat | action | text." },
        viewId: { type: "string", description: "The backing saved view id (UUID) — required for kind view/stat." },
        settings: { type: "object", description: "Per-kind display settings (see description)." },
        layout: { type: "object", description: "Optional grid placement per breakpoint; omit to auto-place." },
      },
      required: ["dashboardId", "kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (ownerId, args) => {
      const dashboardId = asUuid(args.dashboardId, "dashboardId");
      const widget = parseWidget({
        kind: args.kind,
        viewId: args.viewId,
        settings: args.settings,
        layout: args.layout,
      });
      if (!widget) {
        throw new ItemError(
          "bad_request",
          "invalid widget: check kind, and that a view/stat widget has a real viewId"
        );
      }
      const updated = await addWidget(ownerId, dashboardId, widget);
      return dashView(updated);
    },
  },
];
