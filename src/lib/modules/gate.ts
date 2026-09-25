// Turn a disabled module's routes away (ADR-272 step 4). The proxy lets every
// registered module's public paths through without reading settings, so each
// route checks its own module here. Pages use `pageGate`, route handlers `routeGate`.
import { notFound } from "next/navigation";
import { moduleOn } from "@/lib/modules/enabled";
import { getSettings } from "@/lib/settings";

export async function moduleIsOn(ownerId: string, moduleId: string): Promise<boolean> {
  const settings = await getSettings(ownerId).catch(() => ({ modules: {} }));
  return moduleOn(settings, moduleId);
}

// In a route handler: `const off = await routeGate(ownerId, "sharing"); if (off) return off;`
export async function routeGate(ownerId: string, moduleId: string): Promise<Response | null> {
  if (await moduleIsOn(ownerId, moduleId)) return null;
  return Response.json({ error: `The ${moduleId} module is off for this owner.` }, { status: 404 });
}

// In a page or server component: `await pageGate(ownerId, "sharing");`
export async function pageGate(ownerId: string, moduleId: string): Promise<void> {
  if (!(await moduleIsOn(ownerId, moduleId))) notFound();
}
