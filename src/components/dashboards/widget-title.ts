// Leaf helpers shared by WidgetFrame and the container's child chrome: a
// widget's display title and the link its header points at. Kept in its own
// module (no component imports) so both can use it without an import cycle.
import type {
  ContainerWidgetSettings,
  TextWidgetSettings,
  TreeWidgetSettings,
  ViewWidgetSettings,
  WidgetData,
} from "@/lib/dashboard-widgets";

export function widgetTitle(data: WidgetData): string {
  const { widget } = data;
  if (widget.kind === "view") {
    const s = widget.settings as ViewWidgetSettings;
    return s.titleOverride || data.view?.name || "View";
  }
  if (widget.kind === "stat") return data.view?.name || "Count";
  if (widget.kind === "tree") {
    const s = widget.settings as TreeWidgetSettings;
    return s.titleOverride || data.view?.name || "Nested list";
  }
  if (widget.kind === "embed") return data.embedItem?.title || "Untitled";
  if (widget.kind === "container") {
    const s = widget.settings as ContainerWidgetSettings;
    return s.title || "Group";
  }
  if (widget.kind === "text") {
    const s = widget.settings as TextWidgetSettings;
    return s.heading || "Text";
  }
  return "label" in widget.settings ? widget.settings.label || "Action" : "Action";
}

// Where the header title links (when it has a destination).
export function titleHref(data: WidgetData): string | null {
  const { widget } = data;
  if ((widget.kind === "view" || widget.kind === "stat" || widget.kind === "tree") && widget.viewId)
    return `/views/${widget.viewId}`;
  if (widget.kind === "embed" && widget.itemId) return `/items/${widget.itemId}`;
  return null;
}
