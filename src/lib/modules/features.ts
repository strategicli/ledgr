// The feature modules (ADR-272 step 2): switches that add behavior rather than
// an item type, folded onto Build → Modules from the four settings checkboxes
// and the notification-center constant they replace. Pure manifests, no types,
// no canvas. Every folded default is the old key's default (all off), and
// seedModulesFromLegacy (settings.ts) carries an owner's existing choice across,
// so nobody's switch flips on upgrade. `passages` is the exception: it had no
// switch before step 3.6, it always ran, so it defaults on. The code each one
// gates still lives where it did; step 4 of the plan moves it under the module.
//
// Hooks (step 3.6) load their implementation with `await import(...)`: this file
// is on the pure path (register.ts, which verify scripts and client pages
// import), and the implementations reach the database, yt-dlp and
// item-mutations.ts itself.
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
  {
    ...feature(
      "youtube-transcripts",
      "YouTube transcripts",
      "Saved YouTube links fill their body with the video's transcript, using captions or Whisper on this computer."
    ),
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
  },
  feature(
    "notification-center",
    "Notification center",
    "An in-app notification inbox and push alerts. Paused: its reminder jobs are switched off, so turning it on shows the inbox but sends nothing new."
  ),
  {
    ...feature(
      "passages",
      "Scripture passages",
      "Scripture references in a body become links to a passage page."
    ),
    enabledByDefault: true,
    hooks: {
      // Rebuild the item's passage_refs from the saved body. Runs on a cleared
      // body too: clearing a body clears its edges.
      onBodySave: async ({ ownerId, itemId, body }) => {
        const { syncPassageRefs } = await import("@/lib/passages/refs");
        await syncPassageRefs(ownerId, itemId, body);
      },
    },
  },
];
