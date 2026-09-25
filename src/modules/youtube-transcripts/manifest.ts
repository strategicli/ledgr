// The YouTube transcripts module (ADR-242, moved under src/modules by ADR-272
// step 4). Pure: no DB, no yt-dlp. Its save hook and health check live in
// `server.ts`; its scheduled job is `youtube-transcript` in supervisor/jobs.json.
import type { ModuleManifest } from "@/lib/modules";

export const youtubeTranscriptsModule: ModuleManifest = {
  id: "youtube-transcripts",
  label: "YouTube transcripts",
  description:
    "Saved YouTube links fill their body with the video's transcript, using captions or Whisper on this computer.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  routes: ["src/app/api/machine/youtube-transcript/route.ts"],
};
