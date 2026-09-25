import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import {
  applyLegacyModulePatch,
  getSettings,
  updateSettings,
  type UserSettings,
} from "@/lib/settings";
import { ensureNoteEditingPrompt } from "@/lib/note-editing-prompt";
import { agentAvailable } from "@/lib/agent/gate";
import { ensureAgentPrompts } from "@/lib/agent/prompts";
import { moduleOn } from "@/lib/modules/enabled";
import { requiresViolations } from "@/lib/modules";

export const dynamic = "force-dynamic";

// GET /api/settings — the signed-in owner's UI settings (defaults filled in).
export async function GET() {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    return NextResponse.json({ settings: await getSettings(owner.id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// PATCH /api/settings — merge a partial settings patch (validated in the store).
export async function PATCH(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  try {
    const patch = (await request.json()) as Partial<UserSettings>;
    const before = await getSettings(owner.id);
    // The agent block merges per field, so a control that sends one field
    // can't wipe the seeded prompt ids or the "/" ranking.
    if (patch.agent) patch.agent = { ...before.agent, ...patch.agent };
    // Module switches merge per id inside updateSettings, which also maps an
    // old key (aiMemoryEnabled, agent.enabled, …) from an older client onto
    // settings.modules and drops it (ADR-272 step 2).
    // Module requirements (ADR-272 step 3): refuse a switch change that leaves
    // an enabled module without a module it requires. Only NEW violations
    // count, so a mismatch already stored (a requirement added in code later)
    // never blocks saving an unrelated setting.
    const nextModules = applyLegacyModulePatch(patch as Record<string, unknown>, before.modules);
    if (nextModules) {
      const key = (v: { moduleId: string; requires: string }) => `${v.moduleId}>${v.requires}`;
      const known = new Set(requiresViolations(before.modules).map(key));
      const fresh = requiresViolations(nextModules).find((v) => !known.has(key(v)));
      if (fresh) return NextResponse.json({ error: fresh.message }, { status: 400 });
    }
    let settings = await updateSettings(owner.id, patch);
    // First time the in-app agent is turned on on a machine that can run it
    // (ADR-271): seed its editable base and inline-edit prompts.
    if (!moduleOn(before, "agent") && moduleOn(settings, "agent") && agentAvailable()) {
      await ensureAgentPrompts(owner.id);
      settings = await getSettings(owner.id);
    }
    // First time Live editing context is turned on (ADR-162): seed the editable
    // "Note Editing Partner" prompt item, then refresh so the response carries
    // the stored item id.
    if (!moduleOn(before, "live-context") && moduleOn(settings, "live-context")) {
      await ensureNoteEditingPrompt(owner.id);
      settings = await getSettings(owner.id);
    }
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    return errorResponse(err);
  }
}
