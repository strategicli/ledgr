// The helper's status, read from the file it writes (no database here, so the
// Network page and verify scripts can use it). The helper and the supervisor
// write <supervisorDir>/tailscale/status.json; the app only reads it.
//
// Counterpart: parseTailnetStatus() in supervisor/tailnet.mjs. Keep in step.
export type TailnetState = "off" | "starting" | "needs-login" | "running" | "error" | "signed-out";

export type TailnetStatus = {
  state: TailnetState;
  authUrl: string | null;
  dnsName: string | null;
  url: string | null;
  message: string | null;
  // Public access (Funnel, ADR-278): "on", "unavailable" (asked for, refused by
  // the tailnet, with why and the page that fixes it), or null (not asked for).
  funnel: "on" | "unavailable" | null;
  funnelMessage: string | null;
  funnelFixUrl: string | null;
  at: string | null;
};

// Links the owner may be sent to: Tailscale's own pages only.
const tailscaleLink = (u: string | null) =>
  u && (u.startsWith("https://login.tailscale.com/") || u.startsWith("https://tailscale.com/")) ? u : null;

const STATES: TailnetState[] = ["off", "starting", "needs-login", "running", "error", "signed-out"];

export function parseTailnetStatus(text: string): TailnetStatus | null {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (!v || !STATES.includes(v.state as TailnetState)) return null;
    const str = (x: unknown) => (typeof x === "string" && x ? x : null);
    return {
      state: v.state as TailnetState,
      // Only a Tailscale sign-in link is ever opened for the owner.
      authUrl: str(v.authUrl)?.startsWith("https://login.tailscale.com/") ? str(v.authUrl) : null,
      dnsName: str(v.dnsName),
      url: str(v.url)?.startsWith("https://") ? str(v.url) : null,
      message: str(v.message),
      funnel: v.funnel === "on" || v.funnel === "unavailable" ? v.funnel : null,
      funnelMessage: str(v.funnelMessage),
      funnelFixUrl: tailscaleLink(str(v.funnelFixUrl)),
      at: str(v.at),
    };
  } catch {
    return null;
  }
}

export async function readTailnetStatus(supervisorDir: string | null): Promise<TailnetStatus | null> {
  if (!supervisorDir) return null;
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    return parseTailnetStatus(await readFile(join(supervisorDir, "tailscale", "status.json"), "utf8"));
  } catch {
    return null; // never started here: no status is a valid answer
  }
}

/** The private address to hand out, only while the helper is actually serving it. */
export function tailnetAddress(s: TailnetStatus | null): string | null {
  return s?.state === "running" ? s.url : null;
}

/** The same address, only while it is also on the public internet. */
export function funnelAddress(s: TailnetStatus | null): string | null {
  return s?.funnel === "on" ? tailnetAddress(s) : null;
}
