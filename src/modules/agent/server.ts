// Server-only slots for the agent module (ADR-272 step 4). Imported for effect
// by `src/lib/modules/server-slots.ts`, never by the pure path.
import { agentAvailable, agentModule } from "@/modules/agent/manifest";

if (!agentModule.healthCheck) {
  // The in-process sign-in canary the Settings panel shows: no DB read, no
  // model call. A machine that cannot run the agent says so and loads nothing.
  agentModule.healthCheck = async () => {
    if (!agentAvailable()) return { available: false };
    const { health } = await import("@/modules/agent/lib/runtime");
    // Times only: /health shows no error text outside debug mode.
    return { available: true, lastOkAt: health.lastOkAt, lastErrorAt: health.lastError?.at ?? null };
  };
}
