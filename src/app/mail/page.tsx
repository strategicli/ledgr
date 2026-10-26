// Mail (plan note a06242d3, phase 2: reading). Server wrapper: owner, the
// module's switch, and the hub-only check; the screen itself is the client
// MailClient, which reads everything live through /api/mail/read.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import { pageGate } from "@/lib/modules/gate";
import MailClient from "@/modules/mail/components/MailClient";
import { connectedAccounts } from "@/modules/mail/lib/reading";
import { mailAvailable } from "@/modules/mail/manifest";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Mail" };

export default async function MailPage() {
  if (!mailAvailable()) notFound();
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");
  await pageGate(owner.id, "mail");
  // Handed over with the page so the screen never waits on a separate account check.
  return <MailClient accounts={connectedAccounts()} />;
}
