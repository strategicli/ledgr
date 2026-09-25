// Server-only contributions attached onto the pure manifests (ADR-272 step 3,
// split per module in step 4).
//
// A module's `manifest.ts` sits on the pure path: `register.ts` is imported by
// `build-nav.ts` (the client sidebar and the destination picker) and by
// `proxy.ts` (the middleware runtime), so it must not reference anything that
// reaches the database, yt-dlp or child_process, not even behind an
// `await import(...)`, because Turbopack still traces and bundles the target.
// Hooks and health checks do reach those, so each module attaches them in its
// own `server.ts`, and this file imports every one for effect. Only server code
// imports this file: the hook runner (`hooks.ts`), the sync apply path, the
// health report (`health.ts`), and the registry verify script. Each server.ts
// is idempotent, so dev HMR re-evaluating the module graph cannot double-attach.
import "@/lib/modules/register";
// Modules under src/modules attach their own server slots (step 4).
import "@/modules/todoist/server";
import "@/modules/passages/server";
import "@/modules/youtube-transcripts/server";
import "@/modules/sharing/server";
import "@/modules/microsoft/server";
import "@/modules/onedrive-export/server";
import "@/modules/email-capture/server";
import "@/modules/calendar-sync/server";
import "@/modules/relatedness/server";
import "@/modules/agent/server";
import "@/modules/ai-memory/server";
import "@/modules/live-context/server";
