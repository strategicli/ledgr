// The item-panel half of the module wiring (ADR-272 step 4): a panel id to a
// module's React component, so a core canvas can show a module's control
// without importing the module (the core fence, eslint.config.mjs). Kept apart
// from module-wiring.tsx because MarkdownCanvas imports this file and
// module-wiring imports MarkdownCanvas; one file would make that a cycle.
// Each panel gates itself on its module's switch and renders nothing when off.
import type { ReactNode } from "react";
import SharePanel from "@/modules/sharing/components/SharePanel";

type PanelProps = { itemId: string; bare?: boolean };

const ITEM_PANELS: Record<string, (props: PanelProps) => ReactNode | Promise<ReactNode>> = {
  share: SharePanel,
};

export function ModuleItemPanel({ id, ...props }: PanelProps & { id: string }) {
  const Panel = ITEM_PANELS[id];
  return Panel ? <Panel {...props} /> : null;
}
