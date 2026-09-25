// Server-only slots for the calendar sync module (ADR-272 step 4). Imported for
// effect by src/lib/modules/server-slots.ts, never by the pure path.
import { calendarSyncModule } from "@/modules/calendar-sync/manifest";

// The last sync run and the last clean one. health.ts copies them into the
// lastCalendarSyncAt / lastCalendarRunAt keys the weekly check reads.
if (!calendarSyncModule.healthCheck) {
  calendarSyncModule.healthCheck = async () => {
    const { getCalendarState } = await import("@/modules/calendar-sync/lib/sync");
    const s = await getCalendarState();
    return { lastSyncAt: s?.lastSuccessAt ?? null, lastRunAt: s?.lastRunAt ?? null };
  };
}
