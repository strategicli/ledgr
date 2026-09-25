// Server-only slots for the YouTube transcripts module (ADR-272 step 4).
// Imported for effect by `src/lib/modules/server-slots.ts`, never by the pure
// path, because these reach the database, yt-dlp and child_process.
import { allModules } from "@/lib/modules";
import "@/lib/modules/register";

const m = allModules().find((x) => x.id === "youtube-transcripts");
if (m && !m.hooks) {
  m.hooks = {
    // Start transcribing a video the moment it is saved, instead of leaving
    // it to the ten-minute timer. Every capture path (share sheet,
    // bookmarklet, quick capture, MCP) creates through createItem, so this
    // one hook covers them all; the timer stays as the backstop for videos
    // saved while this copy was closed or on another copy.
    onCreate: async ({ ownerId, type, url }) => {
      // The cheap half first, so creating a task or a note costs nothing more.
      if (type !== "link" || !url) return;
      const { isYoutubeVideoUrl, runYoutubeTranscripts } = await import(
        "@/modules/youtube-transcripts/lib/transcripts"
      );
      if (!isYoutubeVideoUrl(url)) return;
      // Only the machine named under Scheduled work does this, exactly as
      // the timer path checks.
      const { jobRunVerdict } = await import("@/lib/job-owners-store");
      const { run } = await jobRunVerdict(ownerId, "youtube-transcript");
      if (!run) return;
      // Detached: the save that started this is an HTTP request too, and it
      // must not be held open while a video is transcribed.
      await runYoutubeTranscripts(ownerId, { detach: true });
    },
  };
}
if (m && !m.healthCheck) {
  // The backlog is the canary: a count that keeps growing means nothing on
  // this instance is transcribing.
  m.healthCheck = async (ownerId) => ({
    pendingVideos: await (
      await import("@/modules/youtube-transcripts/lib/transcripts")
    ).pendingVideoCount(ownerId),
  });
}
