import { notFound } from "next/navigation";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import SetupOwnerForm from "@/components/auth/SetupOwnerForm";
import { resetAvailableHere } from "@/lib/auth/signin-actions";
import { installHasOwner } from "@/lib/instance-owner";

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
  // No owner yet (ADR-275): this is first-run setup, not a reset, so the same
  // tray link shows the setup form here. (Not a redirect: this page streams, so
  // a redirect happens in the browser and would drop the ticket after "#".)
  if (!(await installHasOwner().catch(() => true))) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-lg rounded-card border border-line bg-surface-1 p-6">
          <h1 className="ui-title text-ink">Set up Ledgr</h1>
          <p className="mt-1 mb-4 text-sm text-ink-muted">
            This copy of Ledgr has no owner yet. You are at the computer running it, so you can make yourself its owner.
            This works only here: nobody on your network or the internet can do it.
          </p>
          <SetupOwnerForm />
        </div>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <ResetPasswordForm />
    </main>
  );
}
