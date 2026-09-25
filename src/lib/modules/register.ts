// Module registration boot site (the M6 gap — `registerModule` had no live
// caller until the first real module). Importing this for its side effect
// registers every workflow module onto core. It's pure (manifests only, no
// component imports), so a node verify script can import it to register modules
// without dragging in React. Idempotent: guarded against the duplicate-id throw
// so Next's dev HMR re-evaluating the module graph can't crash the boundary.
//
// NOTE (two-builder repo): where modules register is a core-shared concern — see
// the plan's collaboration note. This is imported for effect by module-wiring.tsx
// (the canvas-dispatch path), so a `song` resolves its `chord` canvas before any
// page renders one.
import { allModules, registerModule, type ModuleManifest } from "@/lib/modules";
import { FEATURE_MODULES } from "@/lib/modules/features";
import { fileModule } from "@/lib/modules/files";
import { mindmapModule } from "@/lib/modules/mindmap";
import { paperModule } from "@/lib/modules/papers";
import { songModule } from "@/lib/modules/songs";
import { todoistModule } from "@/modules/todoist/manifest";
import { passagesModule } from "@/modules/passages/manifest";
import { youtubeTranscriptsModule } from "@/modules/youtube-transcripts/manifest";
import { sharingModule } from "@/modules/sharing/manifest";
import { microsoftModule } from "@/modules/microsoft/manifest";
import { onedriveExportModule } from "@/modules/onedrive-export/manifest";
import { snapshotsModule } from "@/modules/snapshots/manifest";
import { emailCaptureModule } from "@/modules/email-capture/manifest";
import { calendarSyncModule } from "@/modules/calendar-sync/manifest";
import { relatednessModule } from "@/modules/relatedness/manifest";
import { deskModule } from "@/modules/desk/manifest";
import { agentModule } from "@/modules/agent/manifest";
import { aiMemoryModule } from "@/modules/ai-memory/manifest";
import { liveContextModule } from "@/modules/live-context/manifest";

const WORKFLOW_MODULES: ModuleManifest[] = [
  songModule,
  paperModule,
  mindmapModule,
  fileModule,
  todoistModule,
  // Moved under src/modules (step 4), kept here so the Modules page and the MCP
  // instruction blocks keep their order.
  aiMemoryModule,
  liveContextModule,
  ...FEATURE_MODULES,
  // Moved under src/modules/<id>/ (ADR-272 step 4).
  youtubeTranscriptsModule,
  passagesModule,
  sharingModule,
  microsoftModule,
  onedriveExportModule,
  snapshotsModule,
  emailCaptureModule,
  calendarSyncModule,
  relatednessModule,
  deskModule,
  agentModule,
];

for (const m of WORKFLOW_MODULES) {
  if (!allModules().some((existing) => existing.id === m.id)) {
    registerModule(m);
  }
}
