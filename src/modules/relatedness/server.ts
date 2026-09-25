// Server-only slots for the relatedness module (ADR-272 step 4). Imported for
// effect by `src/lib/modules/server-slots.ts`, never by the pure path.
import { relatednessModule } from "@/modules/relatedness/manifest";

if (!relatednessModule.healthCheck) {
  // The last nightly cache refresh. health.ts copies it into the top-level
  // `lastRelatednessRunAt` key that outside readers still read.
  relatednessModule.healthCheck = async () => {
    const { getRelatednessState } = await import("@/modules/relatedness/lib/refresh");
    return { lastRunAt: (await getRelatednessState())?.lastRunAt ?? null };
  };
}
