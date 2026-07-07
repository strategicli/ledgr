// Makes the owner's resolved timezone available to any client component without
// prop-drilling. The root layout resolves it server-side (getAppTimezone) and
// provides it here; client surfaces that format instants — the dashboard widget
// path (WidgetBody → ViewRenderer) especially — read it via useTimezone().
// Server components should keep resolving getAppTimezone(ownerId) directly.
"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_TIMEZONE } from "@/lib/today";

const TimezoneContext = createContext<string>(DEFAULT_TIMEZONE);

export function TimezoneProvider({ tz, children }: { tz: string; children: ReactNode }) {
  return <TimezoneContext.Provider value={tz}>{children}</TimezoneContext.Provider>;
}

// The owner's IANA timezone; DEFAULT_TIMEZONE when used outside a provider.
export function useTimezone(): string {
  return useContext(TimezoneContext);
}
