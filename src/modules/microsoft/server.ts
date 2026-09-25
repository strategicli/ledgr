// Server-only slots for the Microsoft 365 module (ADR-272 step 4). Imported for
// effect by src/lib/modules/server-slots.ts, never by the pure path.
import { allModules } from "@/lib/modules";
import "@/lib/modules/register";

const m = allModules().find((x) => x.id === "microsoft");
// The app-only token grant: the secret-expiry / consent-revocation canary for
// every unattended Graph job. health.ts copies it into the top-level `graph`
// key the weekly check reads. checkGraphAuth swallows its own errors.
if (m && !m.healthCheck) {
  m.healthCheck = async () => {
    const { checkGraphAuth } = await import("@/modules/microsoft/lib/client");
    return checkGraphAuth();
  };
}
