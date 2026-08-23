// "Other devices reach this instance at…" (ADR-212).
//
// The real fix for the hub-URL guesswork, per Brandon: adding a spoke should be
// copy-from-one-screen, paste-into-another, with nothing to derive. So a hub
// shows its OWN addresses rather than making the owner work out the form.
//
// Ordered by preference, and the order is the advice:
//   1. The tailnet hostname (MagicDNS). Readable, and it survives a re-address,
//      which the raw 100.x does not.
//   2. The tailnet IP. Same reachability, uglier, works if MagicDNS is off.
//   3. The LAN address. Works only on this network — worth showing, worth
//      labelling as limited.
//
// A device that can join the tailnet (a phone, a laptop) needs no Funnel at
// all: tailnet-internal addressing is enough and is more private. Funnel is
// only for callers that cannot join a tailnet, and the load-bearing one is the
// claude.ai MCP connector, because that fetch comes from Anthropic's servers
// rather than a device the owner controls. So Funnel is a separate, later step
// and is deliberately not detected here.
export type ReachableAddress = {
  url: string;
  label: string;
  // Why you would (or would not) use this one.
  note: string;
  // The one to reach for first.
  preferred: boolean;
};

export type TailscaleState = {
  // Is the binary there at all?
  installed: boolean;
  // Running and logged in? "NeedsLogin"/"Stopped" are the common not-yet cases.
  running: boolean;
  // MagicDNS name, trailing dot stripped. Null when MagicDNS is off.
  dnsName: string | null;
  ips: string[];
  // Whatever the CLI said when it did not work, for showing the owner.
  detail: string | null;
};

export const TAILSCALE_ABSENT: TailscaleState = {
  installed: false,
  running: false,
  dnsName: null,
  ips: [],
  detail: null,
};

/**
 * Parse `tailscale status --json`, tolerantly. Anything unexpected reads as
 * "installed but not usable" rather than throwing — this feeds a help panel,
 * and a help panel that 500s is worse than one that says "not set up".
 *
 * Counterpart: `parseTailscaleJson()` / `hubUrlHint()` in supervisor/lib.mjs do
 * the same read for the setup wizard, which cannot import TypeScript. Keep them
 * in step.
 */
export function parseTailscaleStatus(raw: string): TailscaleState {
  let v: {
    BackendState?: unknown;
    Self?: { DNSName?: unknown; TailscaleIPs?: unknown };
  };
  try {
    v = JSON.parse(raw) as typeof v;
  } catch {
    return { ...TAILSCALE_ABSENT, installed: true, detail: "could not read tailscale status" };
  }
  const state = typeof v.BackendState === "string" ? v.BackendState : "";
  const dns = typeof v.Self?.DNSName === "string" ? v.Self.DNSName.replace(/\.$/, "") : "";
  const ips = Array.isArray(v.Self?.TailscaleIPs)
    ? v.Self.TailscaleIPs.filter((i): i is string => typeof i === "string")
    : [];
  return {
    installed: true,
    running: state === "Running",
    dnsName: dns || null,
    ips,
    detail:
      state === "Running"
        ? null
        : state === "NeedsLogin"
          ? "Tailscale is installed but not signed in yet."
          : state
            ? `Tailscale is installed but not running (${state}).`
            : "Tailscale is installed but its state could not be read.",
  };
}

/** Tailscale hands out 100.64.0.0/10, so its addresses show up as ordinary
 * interfaces too. Filtering them keeps the LAN row from duplicating the
 * tailnet row under a misleading label. */
export function isTailnetIp(ip: string): boolean {
  const m = /^100\.(\d+)\./.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/**
 * The list a hub shows. Pure, so the ordering and the labelling are testable
 * without a tailnet.
 */
export function reachableAddresses(opts: {
  tailscale: TailscaleState;
  lanIps: string[];
  port: number;
}): ReachableAddress[] {
  const out: ReachableAddress[] = [];
  const { tailscale: ts, port } = opts;

  if (ts.running && ts.dnsName) {
    out.push({
      url: `http://${ts.dnsName}:${port}`,
      label: "Tailnet hostname",
      note: "Use this one. It works from any device signed into your tailnet, anywhere, and it keeps working if the addresses change.",
      preferred: true,
    });
  }
  for (const ip of ts.running ? ts.ips.filter((i) => !i.includes(":")) : []) {
    out.push({
      url: `http://${ip}:${port}`,
      label: "Tailnet address",
      note: "Same reach as the hostname above. Use it if MagicDNS is off.",
      preferred: out.length === 0,
    });
  }
  for (const ip of opts.lanIps.filter((i) => !isTailnetIp(i))) {
    out.push({
      url: `http://${ip}:${port}`,
      label: "Local network",
      note: "Only works from devices on this same network, and it changes when the router reassigns it.",
      preferred: out.length === 0,
    });
  }
  return out;
}

// ── The impure half ─────────────────────────────────────────────────────────

/** Ask the local Tailscale CLI. Never throws: not installed is a normal answer. */
export async function readTailscaleState(): Promise<TailscaleState> {
  const { spawnSync } = await import("node:child_process");
  // On Windows the name needs its .exe: spawn does no PATHEXT resolution, so a
  // bare "tailscale" is ENOENT even when the CLI is on PATH — which is exactly
  // how this read first reported "not installed" on a machine that had it.
  const candidates =
    process.platform === "win32"
      ? ["tailscale.exe", "C:\\Program Files\\Tailscale\\tailscale.exe"]
      : ["tailscale", "/usr/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  for (const bin of candidates) {
    try {
      const res = spawnSync(bin, ["status", "--json"], { encoding: "utf8", timeout: 5000 });
      if (res.error) continue;
      if (typeof res.stdout === "string" && res.stdout.trim()) {
        return parseTailscaleStatus(res.stdout);
      }
      // Ran, said nothing usable: installed, not usable.
      return {
        ...TAILSCALE_ABSENT,
        installed: true,
        detail: (res.stderr || "").trim() || "Tailscale is installed but not signed in yet.",
      };
    } catch {
      // try the next candidate
    }
  }
  return TAILSCALE_ABSENT;
}

/** This machine's own LAN IPv4 addresses. */
export async function readLanIps(): Promise<string[]> {
  const { networkInterfaces } = await import("node:os");
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
  }
  return out;
}
