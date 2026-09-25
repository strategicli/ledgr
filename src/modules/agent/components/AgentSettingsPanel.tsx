// The wrapper `module-panels.tsx` points at for the agent's `settingsPanel`
// (ADR-272 step 3 item 7): AgentSettings itself takes its props (the stored
// agent options, and whether the module is on) from the caller, because
// /settings already had that data in hand. This wrapper is the one place that
// reads them for the Modules page's "Options" disclosure, so both doors render
// the exact same component.
import { getSettings } from "@/lib/settings";
import { moduleOn } from "@/lib/modules/enabled";
import AgentSettings from "./AgentSettings";

export default async function AgentSettingsPanel({ ownerId }: { ownerId: string }) {
  const settings = await getSettings(ownerId);
  return <AgentSettings initial={settings.agent} on={moduleOn(settings, "agent")} />;
}
