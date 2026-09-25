// Build → Modules (MAINTAIN, ADR-272 step 1): every workflow module this
// install ships, each with its own on/off switch. The switch is stored per
// owner in settings.modules; a module the owner never touched follows its
// manifest default. Off hides the module's types from the places new items are
// made (quick capture, "+ New", MCP list_types) and sends existing items of
// those types to the plain document canvas. Nothing is ever deleted. Core is
// not listed: it cannot be turned off.
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { allModules, coreModule } from "@/lib/modules";
import "@/lib/modules/register";
import ModuleToggle from "@/components/build/ModuleToggle";

export const dynamic = "force-dynamic";

export default async function Modules() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const { modules: flags } = await getSettings(owner.id);
  const modules = allModules().filter((m) => m.id !== coreModule.id);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="ui-title">Modules</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        A module is an optional feature set that adds its own kind of item, like
        songs or papers. Turning one off hides it from the places you make new
        items. It never deletes anything: existing items stay, and open on the
        plain document page until you turn the module back on.
      </p>

      <ul className="mt-6 space-y-3">
        {modules.map((m) => {
          const on = flags[m.id] ?? m.enabledByDefault;
          return (
            <li
              key={m.id}
              className="flex items-start justify-between gap-4 rounded-card border border-line bg-surface-1 p-4"
            >
              <div className="min-w-0">
                <p className="ui-row text-ink">{m.label}</p>
                {m.description && (
                  <p className="ui-meta mt-0.5 text-ink-muted">{m.description}</p>
                )}
                <p className="ui-meta mt-1 text-ink-subtle">
                  Adds: {m.types.map((t) => t.label).join(", ") || "no item types"}
                  {" · "}
                  Default {m.enabledByDefault ? "on" : "off"}
                </p>
              </div>
              <ModuleToggle moduleId={m.id} label={m.label} enabled={on} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
