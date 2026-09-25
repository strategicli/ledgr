// ── Notification center: PAUSED (2026-06-29, ADR-130, pausing ADR-129) ──────────
// Brandon's call: the published ICS feed (ADR-079) already gives him a precise,
// offline, per-device reminder + history on whatever calendar he subscribes, so
// the in-app notification center is redundant for now. It is DETACHED without
// deleting anything: the notifications table, migration, the notifications lib,
// the API routes, the /notifications page, and the whole Web Push transport
// (ADR-034: subscriptions, VAPID, service worker, PushToggle) all stay in the
// tree, recoverable. Deferred by hiding (the soft-delete analog for features).
//
// Since ADR-272 step 2 the switch is the `notification-center` module on
// Build → Modules (default off), replacing the old hardcoded
// NOTIFICATION_CENTER_ENABLED constant. Server code asks this helper; client
// components (NavShell, SettingsForm) get the answer as a prop from the server
// component that renders them, and nav-slot-options takes it as an argument.
//
// What the switch gates: the senders in push/notify.ts (so a manual cron
// dispatch is a no-op), the nav link + badges, the Settings "Notifications"
// section, the agenda freshness check in health-check.ts, and a redirect off
// the /notifications page. The two crons are disabled in config too
// (notify-agenda removed from vercel.json; notify-prep.yml `schedule:`
// commented, workflow_dispatch kept), so turning the module on shows the inbox
// but sends nothing new until those are restored.
import { moduleOnFor } from "@/lib/modules/enabled";

export function notificationCenterOn(ownerId: string): Promise<boolean> {
  return moduleOnFor(ownerId, "notification-center");
}
