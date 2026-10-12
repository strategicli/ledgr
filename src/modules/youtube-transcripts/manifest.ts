// The YouTube transcripts module (ADR-242, moved under src/modules by ADR-272
// step 4). Pure: no DB, no yt-dlp. Its save hook and health check live in
// `server.ts`; its scheduled job is `youtube-transcript` in supervisor/jobs.json.
import type { ModuleManifest } from "@/lib/modules";

// Shown as "Media transcripts": it grew past YouTube. The id stays
// "youtube-transcripts" because owners' on/off switches and job ownership are
// stored under it. To cover a new kind of media, add its address test and
// fetcher beside podcast.ts and list it in the description below.
export const youtubeTranscriptsModule: ModuleManifest = {
  id: "youtube-transcripts",
  label: "Media transcripts",
  description:
    "Saved links fill with the words spoken in them, so you can read, search and highlight them. Covers YouTube videos and Pocket Casts podcast episodes. Uses captions or the show's own transcript when there is one, and Whisper on this computer when there is not.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  routes: ["src/app/api/machine/youtube-transcript/route.ts"],
};
