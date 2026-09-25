// The impure half of the module switch (ADR-272 step 1). `modules.ts` stays
// pure, so it asks an injected resolver whether a module is on; this file
// installs that resolver and feeds it the owner's settings.modules map.
//
// The sync/async seam. `getSettings` is async, but `isModuleEnabled` is sync
// and is called from sync resolvers (`canvasIdForType` and friends) inside
// server components. So a server component that resolves a canvas for an owner
// first awaits `preloadModuleSettings(ownerId)`, which reads the (already
// request-cached) settings and parks the map in a React `cache()` holder, one
// per request. The resolver reads that holder. If nothing was preloaded (a
// route handler, where `cache()` is a passthrough, or a call site that skipped
// the preload), the resolver answers undefined and the manifest default wins.
// It never throws. The async paths (type lists, quick capture, MCP) do not use
// this at all: they read settings directly via `disabledModuleTypeKeys`.
import { cache } from "react";
import {
  allModules,
  coreModule,
  setModuleEnabledResolver,
  typeKeysOfDisabledModules,
} from "@/lib/modules";
import "@/lib/modules/register";
import { getSettings, type UserSettings } from "@/lib/settings";

const requestHolder = cache(
  (): { ownerId?: string; flags?: Record<string, boolean> } => ({})
);

setModuleEnabledResolver((moduleId, ownerId) => {
  const h = requestHolder();
  if (!ownerId || h.ownerId !== ownerId) return undefined;
  return h.flags?.[moduleId];
});

export async function preloadModuleSettings(ownerId: string): Promise<void> {
  const { modules } = await getSettings(ownerId);
  const h = requestHolder();
  h.ownerId = ownerId;
  h.flags = modules;
}

// Is this module on, given settings already in hand? The same rule as
// isModuleEnabled (the owner's switch, else the manifest default, core always
// on) but read straight from the settings object, so route handlers, MCP and
// the jobs (where React `cache` is a passthrough) never depend on the preload.
export function moduleOn(settings: Pick<UserSettings, "modules">, moduleId: string): boolean {
  if (moduleId === coreModule.id) return true;
  const m = allModules().find((x) => x.id === moduleId);
  if (!m) return false;
  return settings.modules[moduleId] ?? m.enabledByDefault;
}

// The async form, for a call site that has only the owner id.
export async function moduleOnFor(ownerId: string, moduleId: string): Promise<boolean> {
  return moduleOn(await getSettings(ownerId), moduleId);
}

// The ids of every module this owner has off, for client components (the Build
// sidebar) that filter by module without importing server code.
export function offModuleIds(settings: Pick<UserSettings, "modules">): string[] {
  return allModules()
    .filter((m) => !moduleOn(settings, m.id))
    .map((m) => m.id);
}

// The type keys whose module this owner has switched off.
export async function disabledModuleTypeKeys(ownerId: string): Promise<Set<string>> {
  const { modules } = await getSettings(ownerId);
  return new Set(typeKeysOfDisabledModules(modules));
}
