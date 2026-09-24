// Whether this page has the in-app agent (ADR-271). The root layout stamps
// body[data-agent="on"] when the machine can run it and the owner turned it on.
"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function useAgentOn(): boolean {
  return useSyncExternalStore(
    noop,
    () => document.body.dataset.agent === "on",
    () => false
  );
}
