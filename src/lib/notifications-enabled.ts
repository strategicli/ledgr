// ── Notification center: PAUSED (2026-06-29, ADR-130, pausing ADR-129) ──────────
// Brandon's call: the published ICS feed (ADR-079) already gives him a precise,
// offline, per-device reminder + history on whatever calendar he subscribes, so
// the in-app notification center is redundant for now. This flag DETACHES it
// without deleting anything — the notifications table, migration, the
// notifications lib, the API routes, the /notifications page, and the whole Web
// Push transport (ADR-034: subscriptions, VAPID, service worker, PushToggle) all
// stay in the tree, recoverable, in case a more capable notifications app is
// built later. Deferred by hiding (the soft-delete analog for features), not dead.
//
// Lives in its own dependency-free module (no db imports) so both server code
// AND client components ("use client": NavShell, SettingsForm) can read it
// without dragging server-only code into the client bundle.
//
// What this flag gates (search for NOTIFICATION_CENTER_ENABLED): the senders in
// push/notify.ts (so a manual cron dispatch is a no-op), the nav link + badges,
// the Settings "Notifications" section, and a redirect off the /notifications
// page. The two crons are disabled in config too (notify-agenda removed from
// vercel.json; notify-prep.yml `schedule:` commented, workflow_dispatch kept).
//
// TO RE-ENABLE: flip this to true, restore the notify-agenda entry in
// vercel.json and the `schedule:` in .github/workflows/notify-prep.yml, redeploy.
// Nothing else was removed. Do NOT "tidy up" the dormant code — it's deferred on
// purpose.
export const NOTIFICATION_CENTER_ENABLED = false;
