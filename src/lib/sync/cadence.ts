// The sync cadence values (ADR-210), pure: no DB, no node builtins. Split out
// of client.ts so the client components that render a cadence (HubActions,
// FallbackPrompt) import these without dragging the whole server sync graph,
// and everything it imports, into the browser bundle. client.ts re-exports
// them, so server callers are unchanged. The design notes stay in client.ts.
export type HubCadence = number;
export type HubFallback = "automatic" | "prompt";

export const CADENCE_DAILY_MS = 24 * 60 * 60 * 1000;
export const CADENCE_CONTINUOUS = 0;
export const CADENCE_DAILY_MINUTES = 1440;
export const CADENCE_WEEKLY_MINUTES = 10_080;

/**
 * The ladder the owner picks from. Presets, not free entry: a text box invites
 * "every 3 minutes on a Tuesday" and nothing in the loop rewards that
 * precision. The supervisor's job config made the same call and says why.
 */
export const CADENCE_PRESETS: { minutes: number; label: string }[] = [
  { minutes: CADENCE_CONTINUOUS, label: "Continuously" },
  { minutes: 1, label: "Every minute" },
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: CADENCE_DAILY_MINUTES, label: "Once a day" },
  { minutes: CADENCE_WEEKLY_MINUTES, label: "Once a week" },
];

/** How a cadence reads in a sentence, for any value including stored ones. */
export function cadenceLabel(minutes: HubCadence): string {
  const preset = CADENCE_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes < CADENCE_DAILY_MINUTES) return `Every ${Math.round(minutes / 60)} hours`;
  return `Every ${Math.round(minutes / CADENCE_DAILY_MINUTES)} days`;
}
