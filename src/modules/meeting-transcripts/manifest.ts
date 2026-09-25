// The meeting transcripts module (ADR-087/088, moved under src/modules by
// ADR-272 step 4). Pure: no DB, no provider. Its health check lives in
// `server.ts`; its scheduled job is `transcription-poll` in supervisor/jobs.json.
//
// The boundary. The `transcript` item type and its data model
// (src/lib/meetings/transcripts.ts) stay core: the Android share target files a
// long shared text as an inbox transcript before the owner decides what it is,
// and that must keep working with this module off. This module is the meeting
// side: the Transcripts panel on a meeting (paste, upload a file, upload audio),
// the AssemblyAI provider (live only when ASSEMBLYAI_API_KEY is set), the
// audio-to-transcript orchestration, the poll job, and "add to a meeting" on
// the share screen.
import type { ModuleManifest } from "@/lib/modules";

export const meetingTranscriptsModule: ModuleManifest = {
  id: "meeting-transcripts",
  label: "Meeting transcripts",
  description:
    "Adds a Transcripts panel to meetings: paste a transcript, upload a transcript file, or upload a recording to transcribe it.",
  // On everywhere before it had a switch; an upgrade must not hide it.
  enabledByDefault: true,
  types: [],
  exporters: [],
  routes: [
    "src/app/api/meetings/[id]/transcribe/route.ts",
    "src/app/api/meetings/[id]/transcripts/route.ts",
    "src/app/api/transcription/[id]/status/route.ts",
    "src/app/api/transcripts/[id]/attach/route.ts",
    "src/app/api/machine/transcription-poll/route.ts",
  ],
};
