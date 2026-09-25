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
import LiveContextPanel from "@/modules/live-context/components/LiveContextPanel";
import MeetingTranscripts from "@/modules/meeting-transcripts/components/MeetingTranscripts";

type PanelProps = { itemId: string; title?: string; bare?: boolean; collapsed?: boolean };

const ITEM_PANELS: Record<string, (props: PanelProps) => ReactNode | Promise<ReactNode>> = {
  share: SharePanel,
  discover: DiscoverSection,
  "live-context": LiveContextPanel,
  "meeting-transcripts": MeetingTranscripts,
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

// The root layout's shell panels (the Desk's Send-to-Desk popover, the Claude
// sidebar) are listed in module-shells.tsx, not here: the layout imports that
// file, and importing this one would put every item panel's client code in the
// root bundle of every page (plan step 5).

// --- settings panels: a module's own options on /build/modules (ADR-272) ---
// A module's `settingsPanel` (a panel id, not a schema — see the comment on
// that field in modules.ts) resolves here, the same way an item panel does
// above. The agent declares one (its model choices and prompt links, wrapped
// so the Modules page can render them without its own fetch
// (`AgentSettingsPanel`, which reads the owner's settings and hands
// `AgentSettings` the same props /settings already passes it directly), and
// Tailscale its Connect / address / Disconnect controls.
import AgentSettingsPanel from "@/modules/agent/components/AgentSettingsPanel";
import TailscaleSettingsPanel from "@/modules/tailscale/components/TailscaleSettingsPanel";

type SettingsPanelProps = { ownerId: string };

const MODULE_SETTINGS_PANELS: Record<
  string,
  (props: SettingsPanelProps) => ReactNode | Promise<ReactNode>
> = {
  agent: AgentSettingsPanel,
  tailscale: TailscaleSettingsPanel,
};

export function ModuleSettingsPanel({
  id,
  ownerId,
}: SettingsPanelProps & { id: string }) {
  const Panel = MODULE_SETTINGS_PANELS[id];
  return Panel ? <Panel ownerId={ownerId} /> : null;
}
