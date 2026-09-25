// The feature modules (ADR-272 step 2): switches that add behavior rather than
// an item type, folded onto Build → Modules from the four settings checkboxes
// and the notification-center constant they replace. Pure manifests, no types,
// no canvas. Every folded default is the old key's default (all off), and
// seedModulesFromLegacy (settings.ts) carries an owner's existing choice across,
// so nobody's switch flips on upgrade. Step 4 of the plan moves each one's code
// under src/modules/<id>/, and a moved module's manifest leaves this list for
// register.ts (youtube-transcripts, passages, ai-memory and live-context have).
//
// Hooks and health checks (step 3.4 to 3.6) are NOT declared here: this file is
// on the pure path (register.ts, imported by build-nav.ts for the client sidebar
// and by proxy.ts for the middleware), and their implementations reach the
// database, yt-dlp and child_process. `server-slots.ts` attaches them on the
// server only.
import type { ModuleManifest } from "@/lib/modules";

const feature = (
  id: string,
  label: string,
  description: string,
  slots: Partial<ModuleManifest> = {}
): ModuleManifest => ({
  id,
  label,
  description,
  enabledByDefault: false,
  types: [],
  exporters: [],
  ...slots,
});

export const FEATURE_MODULES: ModuleManifest[] = [
  feature(
    "notification-center",
    "Notification center",
    "An in-app notification inbox and push alerts. Paused: its reminder jobs are switched off, so turning it on shows the inbox but sends nothing new."
  ),
];
