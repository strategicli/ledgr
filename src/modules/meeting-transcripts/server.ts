// Server-only slots for the meeting transcripts module (ADR-272 step 4).
// Imported for effect by `src/lib/modules/server-slots.ts`, never by the pure path.
import { meetingTranscriptsModule } from "@/modules/meeting-transcripts/manifest";

if (!meetingTranscriptsModule.healthCheck) {
  // The active adapter: "none" (paste-only) or "assemblyai" (audio upload on).
  // health.ts copies it into the top-level `transcription` key outside readers
  // still read.
  meetingTranscriptsModule.healthCheck = async () => ({
    adapter: (await import("@/modules/meeting-transcripts/lib/provider")).transcriptionAdapter(),
  });
}
