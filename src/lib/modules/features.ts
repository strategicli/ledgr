// The feature modules (ADR-272 step 2): switches that add behavior rather than
// an item type, folded onto Build → Modules from the four settings checkboxes
// and the notification-center constant they replace. Pure manifests, no types,
// no canvas. Every default is the old key's default (all off), and
// seedModulesFromLegacy (settings.ts) carries an owner's existing choice across,
// so nobody's switch flips on upgrade. The code each one gates still lives where
// it did; step 4 of the plan moves it under the module.
import type { ModuleManifest } from "@/lib/modules";

const feature = (id: string, label: string, description: string): ModuleManifest => ({
  id,
  label,
  description,
  enabledByDefault: false,
  types: [],
  exporters: [],
});

export const FEATURE_MODULES: ModuleManifest[] = [
  feature(
    "ai-memory",
    "AI Memory",
    "Lets Claude keep durable memories in Ledgr over MCP, with a Build → AI Memory page to review them."
  ),
  feature(
    "live-context",
    "Live editing context",
    "Tells Claude which item you have open and what text you selected, so it can edit the note you are looking at."
  ),
  feature(
    "agent",
    "In-app agent",
    "A Claude sidebar, inline edit and slash commands inside Ledgr, run under this computer's Claude login."
  ),
  feature(
    "youtube-transcripts",
    "YouTube transcripts",
    "Saved YouTube links fill their body with the video's transcript, using captions or Whisper on this computer."
  ),
  feature(
    "notification-center",
    "Notification center",
    "An in-app notification inbox and push alerts. Paused: its reminder jobs are switched off, so turning it on shows the inbox but sends nothing new."
  ),
];
