// The Tailscale module's options on Build → Modules (its `settingsPanel`).
// Server component: reads this computer's switch and the helper's status file,
// and draws the QR code on the server so no QR code ships to the browser.
//
// The states, in the order an owner meets them:
//   off          → "Connect with Tailscale"
//   starting     → "Starting…" (first time: downloading the helper)
//   needs-login  → "Sign in to Tailscale" (the link the helper reported)
//   running      → the private address, Copy, a QR code, Disconnect
//   error        → what went wrong, in words, plus Disconnect to start over
import { renderSVG } from "uqr";
import CopyAddress from "@/components/network/CopyAddress";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";
import { readTailnetStatus } from "@/modules/tailscale/lib/status";
import { readTailscaleEnabled } from "@/modules/tailscale/lib/switch";
import { AutoRefresh, ConnectButton, DisconnectButton } from "./TailscaleActions";

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group relative cursor-help">
      <span className="underline decoration-neutral-600 decoration-dotted underline-offset-2">{label}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 w-72 rounded-card border border-neutral-700 bg-neutral-900 p-2 text-xs normal-case text-ink-muted opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export default async function TailscaleSettingsPanel() {
  const dir = process.env.LEDGR_SUPERVISOR_DIR ?? null;
  if (!tailscaleAvailable() || !dir) {
    return <p className="ui-meta text-ink-subtle">Private access runs only on a Ledgr installed on your own computer.</p>;
  }
  const [enabled, status] = await Promise.all([readTailscaleEnabled(), readTailnetStatus(dir)]);
  const state = enabled ? (status?.state ?? "starting") : "off";

  if (state === "off" || state === "signed-out") {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p>
          Reach this Ledgr from your phone and other devices, anywhere, without putting it on the public internet.
          Ledgr joins your own{" "}
          <Tip label="Tailscale network">
            Tailscale is a free service that links your own devices into a private network. Only devices signed in
            to your Tailscale account can reach this Ledgr. If you do not have an account yet, signing in creates one.
          </Tip>{" "}
          as a device of its own. This computer does not need the Tailscale app.
        </p>
        {status?.state === "signed-out" && (
          <p className="ui-meta text-ink-subtle">
            Disconnected. Tailscale still lists this Ledgr as an offline device.{" "}
            <a
              href="https://login.tailscale.com/admin/machines"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-ink"
            >
              Remove it in Tailscale
            </a>{" "}
            if you are done with it, or before connecting again to keep the same name.
          </p>
        )}
        <ConnectButton />
      </div>
    );
  }

  if (state === "running" && status?.url) {
    // uqr's default black on white on purpose, in both themes: phone cameras
    // read a dark-on-light code most reliably.
    const qr = renderSVG(status.url, { border: 2 });
    return (
      <div className="space-y-3 text-sm text-ink-muted">
        <p className="text-ink">
          Connected.{" "}
          <Tip label="Your private address">
            Works on any device signed in to the same Tailscale account, from anywhere. It is not on the public
            internet, and it keeps working if this computer&apos;s network address changes.
          </Tip>
          :
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-card border border-line bg-surface-1 px-2 py-1 text-ink">{status.url}</code>
          <CopyAddress value={status.url} />
        </div>
        <div className="flex flex-wrap items-start gap-4">
          {/* The SVG is generated here from the address alone, never from input. */}
          <div
            className="w-40 shrink-0 overflow-hidden rounded-card bg-white"
            aria-label={`QR code for ${status.url}`}
            role="img"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="max-w-xs">
            Install the Tailscale app on your phone, sign in with the same account, then scan this.
          </p>
        </div>
        <DisconnectButton />
      </div>
    );
  }

  if (state === "needs-login" && status?.authUrl) {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p>One step left: sign in to Tailscale so this computer can join your network.</p>
        <a
          href={status.authUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-card border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-ink hover:bg-surface-3"
        >
          Sign in to Tailscale
        </a>
        <p className="ui-meta text-ink-subtle">
          Use the account your other devices use. This page updates by itself once you have signed in.
        </p>
        <AutoRefresh />
        <DisconnectButton label="Cancel" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p className="text-ink">Private access is not working yet.</p>
        <p>{status?.message ?? "The Tailscale helper reported a problem."}</p>
        <p className="ui-meta text-ink-subtle">Ledgr keeps retrying. This page updates by itself.</p>
        <AutoRefresh />
        <DisconnectButton label="Turn off" />
      </div>
    );
  }

  // starting, or switched on and waiting for the local service to act.
  return (
    <div className="space-y-2 text-sm text-ink-muted">
      <p>Starting private access… The first time, Ledgr downloads a small helper, which takes a moment.</p>
      <AutoRefresh />
      <DisconnectButton label="Cancel" />
    </div>
  );
}
