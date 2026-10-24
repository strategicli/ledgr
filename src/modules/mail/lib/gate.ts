// Every mail route opens with this: signed-in owner, module on, and running on
// the hub. The hub check is the manifest's own `available` (the Tailscale
// one), so a route can never be looser than the Modules page.
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/api";
import { routeGate } from "@/lib/modules/gate";
import { mailAvailable } from "@/modules/mail/manifest";

export async function mailGate() {
  if (!mailAvailable()) {
    return NextResponse.json(
      { error: "Mail runs only on a Ledgr installed on your own computer." },
      { status: 400 }
    );
  }
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;
  const off = await routeGate(owner.id, "mail");
  if (off) return off;
  return { owner };
}
