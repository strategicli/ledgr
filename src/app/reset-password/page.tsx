import { notFound } from "next/navigation";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { resetAvailableHere } from "@/lib/auth/signin-actions";

export const dynamic = "force-dynamic";

// "Reset sign-in password" at the computer running Ledgr (ADR-274), the path
// every confused owner is pointed at. The tray menu (or `npm run
// local:reset-password`) writes a one-time ticket into this install's data
// folder and opens this page on localhost with the ticket after the address's
// "#", which never reaches a server log. Sitting at the machine is the proof.
//
// A 404 anywhere else: on Vercel, on a copy the supervisor doesn't run, and to
// any request that arrived through the tunnel or Tailscale (its address is the
// public name, not localhost). The actions re-check all of it plus the ticket.
export default async function ResetPasswordPage() {
  if (!(await resetAvailableHere())) notFound();
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <ResetPasswordForm />
    </main>
  );
}
