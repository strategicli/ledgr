// The impure half of the save hooks (ADR-272 step 3.6): read the owner's module
// switches once, then run each enabled module's hook in turn. A hook that throws
// is written to Build -> Errors and the next one still runs, so one module can
// never fail or block a save. runHooks itself never rejects, which is what lets
// createItem fire it and forget it.
import { hooksFor, type HookContext, type HookFn, type HookName } from "@/lib/modules";
import { moduleOn } from "@/lib/modules/enabled";
import { getSettings } from "@/lib/settings";
import { captureError } from "@/lib/log";

type Report = (source: string, err: unknown, opts: { detail: unknown }) => Promise<void>;

// The loop, with the hook list and the error sink injected, so a verify script
// can prove a throwing hook does not stop the next one without a database.
export async function runEach(
  name: HookName,
  hooks: { moduleId: string; run: HookFn }[],
  ctx: HookContext,
  report: Report = captureError
): Promise<void> {
  for (const h of hooks) {
    try {
      await h.run(ctx);
    } catch (err) {
      await report("module-hook", err, {
        detail: { module: h.moduleId, hook: name, itemId: ctx.itemId },
      }).catch(() => {});
    }
  }
}

export async function runHooks(name: HookName, ctx: HookContext): Promise<void> {
  // An unreadable settings row falls back to the manifest defaults, so a
  // default-on hook (passages) keeps running exactly as it did before hooks.
  const settings = await getSettings(ctx.ownerId).catch(() => ({ modules: {} }));
  await runEach(name, hooksFor(name, (id) => moduleOn(settings, id)), ctx);
}
