// Build → Modules (MAINTAIN, ADR-272): every optional module this install
// ships, each with its own on/off switch, in two groups. "Item types" add a
// kind of item (songs, papers, …): off hides the type from the places new items
// are made and sends existing items to the plain document canvas. "Features"
// add behavior with no type (AI Memory, the in-app agent, …), folded here in
// step 2 from the checkboxes that used to live on /settings and /build/jobs.
// The switch is stored per owner in settings.modules; a module the owner never
// touched follows its manifest default. Nothing is ever deleted. Core is not
// listed: it cannot be turned off.
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import { allModules, coreModule, type ModuleManifest } from "@/lib/modules";
import { moduleOn } from "@/lib/modules/enabled";
import { agentAvailable } from "@/lib/agent/gate";
import ModuleToggle from "@/components/build/ModuleToggle";

export const dynamic = "force-dynamic";

// Why a switch can't be flipped on this machine, when it can't. The agent runs
// under this computer's Claude login, so only a local install that is its own
// hub can run it (lib/agent/gate.ts).
function unavailableReason(m: ModuleManifest): string | null {
  if (m.id === "agent" && !agentAvailable()) {
    return "Not available here: the agent runs only on a Ledgr installed on your own computer, not on the cloud copy or a synced second computer.";
  }
  return null;
}

export default async function Modules() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const settings = await getSettings(owner.id);
  const modules = allModules().filter((m) => m.id !== coreModule.id);
  const groups = [
    {
      label: "Item types",
      modules: modules.filter((m) => m.types.length > 0),
    },
    {
      label: "Features",
      modules: modules.filter((m) => m.types.length === 0),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <h1 className="ui-title">Modules</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        A module is an optional part of Ledgr: a kind of item, like songs or
        papers, or a feature, like AI Memory. Every switch you have is on this
        page. Turning a module off never deletes anything: existing items stay,
        and open on the plain document page until you turn it back on.
      </p>

      {groups.map((g) => (
        <section key={g.label} className="mt-8">
          <h2 className="ui-section-label">{g.label}</h2>
          <ul className="mt-3 space-y-3">
            {g.modules.map((m) => {
              const reason = unavailableReason(m);
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
                      {m.types.length > 0 && (
                        <>Adds: {m.types.map((t) => t.label).join(", ")} · </>
                      )}
                      Default {m.enabledByDefault ? "on" : "off"}
                    </p>
                    {reason && <p className="ui-meta mt-1 text-ink-subtle">{reason}</p>}
                  </div>
                  <ModuleToggle
                    moduleId={m.id}
                    label={m.label}
                    enabled={moduleOn(settings, m.id)}
                    disabled={!!reason}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
