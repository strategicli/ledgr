// Build → Modules (MAINTAIN, ADR-272): every optional module this install
// ships, each with its own on/off switch, in two groups. "Item types" add a
// kind of item (songs, papers, …): off hides the type from the places new items
// are made and sends existing items to the plain document canvas. "Features"
// add behavior with no type (AI Memory, the in-app agent, …), folded here in
// step 2 from the checkboxes that used to live on /settings and /build/jobs.
// The switch is stored per owner in settings.modules; a module the owner never
// touched follows its manifest default. Nothing is ever deleted. Core is not
// listed: it cannot be turned off.
//
// Requirements (the manifest `requires` slot, ADR-272 step 3): a module another
// enabled module needs cannot be switched off here, and switching a module on
// switches on what it needs too. PATCH /api/settings enforces the same rule.
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { getSettings } from "@/lib/settings";
import {
  allModules,
  coreModule,
  requirementsOf,
  type ModuleManifest,
} from "@/lib/modules";
import { moduleOn } from "@/lib/modules/enabled";
import ModuleToggle from "@/components/build/ModuleToggle";
import { ModuleSettingsPanel } from "@/lib/module-panels";

export const dynamic = "force-dynamic";

// Why a switch can't be flipped on this machine, when it can't. The agent runs
// under this computer's Claude login, so only a local install that is its own
// hub can run it (the manifest's `available`, src/modules/agent/manifest.ts).
function unavailableReason(m: ModuleManifest): string | null {
  if (m.available?.() === false) {
    return m.id === "agent"
      ? "Not available here: the agent runs only on a Ledgr installed on your own computer, not on the cloud copy or a synced second computer."
      : "Not available on this machine.";
  }
  return null;
}

export default async function Modules() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  const settings = await getSettings(owner.id);
  const on = (id: string) => moduleOn(settings, id);
  const labelOf = (id: string) => allModules().find((x) => x.id === id)?.label ?? id;
  // Why an on module can't be turned off: an enabled module requires it.
  const requiredByReason = (m: ModuleManifest): string | null => {
    if (!on(m.id)) return null;
    const by = allModules().filter((x) => on(x.id) && x.requires?.includes(m.id));
    return by.length ? `Required by ${by.map((x) => x.label).join(", ")}` : null;
  };
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
              const reason = unavailableReason(m) ?? requiredByReason(m);
              // What switching this on also switches on: its requirements that are off.
              const alsoEnable = on(m.id) ? [] : requirementsOf(m.id).filter((r) => !on(r));
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
                    {m.perInstallNote && (
                      <p className="ui-meta mt-1 text-ink-subtle">
                        <Link href={m.perInstallNote.href} className="hover:underline">
                          {m.perInstallNote.text}
                        </Link>
                      </p>
                    )}
                    {on(m.id) && m.settingsPanel && (
                      <details id={`${m.id}-options`} className="mt-2" open={m.settingsPanelOpen}>
                        <summary className="ui-meta cursor-pointer text-ink-subtle">
                          Options
                        </summary>
                        <div className="mt-2">
                          <ModuleSettingsPanel id={m.settingsPanel} ownerId={owner.id} />
                        </div>
                      </details>
                    )}
                  </div>
                  <ModuleToggle
                    moduleId={m.id}
                    label={m.label}
                    enabled={on(m.id)}
                    disabled={!!reason}
                    alsoEnable={alsoEnable}
                    note={
                      alsoEnable.length
                        ? `Turning this on also turns on ${alsoEnable.map(labelOf).join(", ")}.`
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* Switches that live per computer, not per owner, so they never show
          on/off state here — the row above just points at where each one
          lives (ADR-272 step 3 item 7). */}
      <section className="mt-8">
        <h2 className="ui-section-label">Per-install settings</h2>
        <p className="mt-1 text-sm text-ink-muted">
          These are set separately on each computer running Ledgr, not once for
          the owner like the switches above.
        </p>
        <ul className="mt-3 space-y-3">
          <li className="rounded-card border border-line bg-surface-1 p-4">
            <p className="ui-row text-ink">Backups</p>
            <p className="ui-meta mt-0.5 text-ink-muted">
              Whether this computer keeps hourly restore points.
            </p>
            <Link href="/build/backups" className="ui-meta mt-1 inline-block text-ink-subtle hover:underline">
              Build → Backups
            </Link>
          </li>
          <li className="rounded-card border border-line bg-surface-1 p-4">
            <p className="ui-row text-ink">Network</p>
            <p className="ui-meta mt-0.5 text-ink-muted">
              Whether this computer sends its changes to your other copies.
            </p>
            <Link href="/build/network#state" className="ui-meta mt-1 inline-block text-ink-subtle hover:underline">
              Build → Network
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
