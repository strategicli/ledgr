// Server-only slots for Claude Runs (ADR-284), imported for effect by
// src/lib/modules/server-slots.ts. Idempotent under dev HMR.
import { allModules, type HookFn } from "@/lib/modules";
import "@/lib/modules/register";

const m = allModules().find((x) => x.id === "claude-runs");
if (m && !m.hooks) {
  // Cheap type check first, so every other save costs nothing.
  const ping: HookFn = async ({ ownerId, itemId, type }) => {
    if (type !== "claude_run") return;
    const { notifyIfAsked } = await import("@/modules/claude-runs/lib/runs");
    await notifyIfAsked(ownerId, itemId);
  };
  m.hooks = { onCreate: ping, onUpdate: ping };
}
