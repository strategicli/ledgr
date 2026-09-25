// Named Desk workspaces, typed (ADR-146). Core settings stores them as an opaque
// slot (settings.deskWorkspaces, layout: unknown) because core may not import
// this module (ADR-272 step 4). The Desk page runs them through here before use:
// an entry whose layout fails sanitizeLayout (garbage, an unknown version) is
// dropped, exactly as settings.ts used to do on read.
import type { DeskWorkspace as StoredWorkspace } from "@/lib/settings";
import { sanitizeLayout, type DeskLayout } from "./layout";

export type DeskWorkspace = Omit<StoredWorkspace, "layout"> & { layout: DeskLayout };

export function sanitizeWorkspaces(stored: StoredWorkspace[]): DeskWorkspace[] {
  const out: DeskWorkspace[] = [];
  for (const w of stored) {
    const layout = sanitizeLayout(w.layout);
    if (layout) out.push({ ...w, layout });
  }
  return out;
}
