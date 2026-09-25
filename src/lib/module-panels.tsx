// The item-panel half of the module wiring (ADR-272 step 4): a panel id to a
// module's React component, so a core canvas can show a module's control
// without importing the module (the core fence, eslint.config.mjs). Kept apart
// from module-wiring.tsx because MarkdownCanvas imports this file and
// module-wiring imports MarkdownCanvas; one file would make that a cycle.
// Each panel gates itself on its module's switch and renders nothing when off.
import type { ReactNode } from "react";
import SharePanel from "@/modules/sharing/components/SharePanel";
import DiscoverSection from "@/modules/relatedness/components/DiscoverSection";
import ExploreView from "@/modules/relatedness/components/ExploreView";
import DeskSendContextMenu from "@/modules/desk/components/DeskSendMenu";

type PanelProps = { itemId: string; title?: string; bare?: boolean };

const ITEM_PANELS: Record<string, (props: PanelProps) => ReactNode | Promise<ReactNode>> = {
  share: SharePanel,
  discover: DiscoverSection,
};

export function ModuleItemPanel({ id, ...props }: PanelProps & { id: string }) {
  const Panel = ITEM_PANELS[id];
  return Panel ? <Panel {...props} /> : null;
}

// A whole page a module owns under a core route (a route file in
// src/app/items/** may not import a module). Each page gates itself and 404s
// while its module is off.
type PageProps = { itemId: string; search: Record<string, string | undefined> };

const ITEM_PAGES: Record<string, (props: PageProps) => ReactNode | Promise<ReactNode>> = {
  explore: ExploreView,
};

export function ModuleItemPage({ id, ...props }: PageProps & { id: string }) {
  const Page = ITEM_PAGES[id];
  return Page ? <Page {...props} /> : null;
}

// --- shell panels: mounted once in the root layout (ADR-272 step 4) ---
// A module's app-wide surface (the Desk's Send-to-Desk popover, the Claude
// sidebar), mounted by the fenced root layout without importing the module. The
// layout renders each entry only while its module is on for the owner (and, for
// a module with `available`, only on a machine that can run it).
import AgentPanel from "@/modules/agent/components/AgentPanel";

type ShellPanel = { moduleId: string; Component: () => ReactNode };

export function shellPanels(): ShellPanel[] {
  return [
    // The Desk's "Send to Desk" popover, opened by inline mention/link
    // right-clicks (ADR-146 S3b).
    { moduleId: "desk", Component: DeskSendContextMenu },
    { moduleId: "agent", Component: AgentPanel },
  ];
}
