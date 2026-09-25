// Server-only contributions attached onto the pure manifests (ADR-272 step 3).
//
// `features.ts` sits on the pure path: `register.ts` is imported by
// `build-nav.ts` (the client sidebar and the destination picker) and by
// `proxy.ts` (the middleware runtime), so it must not reference anything that
// reaches the database, yt-dlp or child_process, not even behind an
// `await import(...)`, because Turbopack still traces and bundles the target.
// Hooks and health checks do reach those, so they are attached here instead,
// and only server code imports this file: the hook runner (`hooks.ts`), the
// health report (`health.ts`), and the registry verify script. Idempotent, so
// dev HMR re-evaluating the module graph cannot double-attach.
import { allModules, type ModuleManifest } from "@/lib/modules";
import "@/lib/modules/register";

const SERVER_SLOTS: Record<string, Pick<ModuleManifest, "hooks" | "healthCheck">> = {
  "youtube-transcripts": {
    hooks: {
      // Start transcribing a video the moment it is saved, instead of leaving
      // it to the ten-minute timer. Every capture path (share sheet,
      // bookmarklet, quick capture, MCP) creates through createItem, so this
      // one hook covers them all; the timer stays as the backstop for videos
      // saved while this copy was closed or on another copy.
      onCreate: async ({ ownerId, type, url }) => {
        // The cheap half first, so creating a task or a note costs nothing more.
        if (type !== "link" || !url) return;
        const { isYoutubeVideoUrl, runYoutubeTranscripts } = await import("@/lib/youtube/transcripts");
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
    },
    // The backlog is the canary: a count that keeps growing means nothing on
    // this instance is transcribing.
    healthCheck: async (ownerId) => ({
      pendingVideos: await (await import("@/lib/youtube/transcripts")).pendingVideoCount(ownerId),
    }),
  },
  passages: {
    hooks: {
      // Rebuild the item's passage_refs from the saved body. Runs on a cleared
      // body too: clearing a body clears its edges.
      onBodySave: async ({ ownerId, itemId, body }) => {
        const { syncPassageRefs } = await import("@/lib/passages/refs");
        await syncPassageRefs(ownerId, itemId, body);
      },
    },
  },
};

for (const m of allModules()) {
  const slots = SERVER_SLOTS[m.id];
  if (!slots) continue;
  if (slots.hooks && !m.hooks) m.hooks = slots.hooks;
  if (slots.healthCheck && !m.healthCheck) m.healthCheck = slots.healthCheck;
}
