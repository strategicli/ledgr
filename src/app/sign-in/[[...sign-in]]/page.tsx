import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import PasswordSignIn from "@/components/auth/PasswordSignIn";
import { passwordOwner } from "@/lib/auth/builtin";
import { builtinAllowedHere, builtinOnState } from "@/lib/auth/builtin-state";
import { safeRedirect } from "@/lib/auth/builtin-core";

export const dynamic = "force-dynamic";

// In-app sign-in page (vs Clerk's hosted account portal) so sign-in works
// the same on a dev instance today and a production instance once a real
// domain exists. Which connections show is per-instance Clerk dashboard
// config: Microsoft on Brandon's instance, Google on Tyler's.
//
// Password sign-in (ADR-274) shares the page. Which form shows is this copy's
// sign-in method, and the other stays one link away whenever it is set up too
// ("both doors open"), so a wrong switch never locks the owner out. A copy that
// never set a password shows exactly what it always did.
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ "sign-in"?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ "sign-in": rest }, sp] = await Promise.all([params, searchParams]);
  const clerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const want = typeof sp.with === "string" ? sp.with : null;
  const redirectUrl = safeRedirect(typeof sp.redirect_url === "string" ? sp.redirect_url : "/");

  const allowed = builtinAllowedHere();
  const owner = allowed ? await passwordOwner().catch(() => null) : null;
  // Only read (and so create) this copy's sign-in row when it can matter: a
  // Clerk copy with no password set behaves exactly as before.
  const on = allowed && (owner || !clerk) ? await builtinOnState() : false;

  // Clerk's own sub-steps (/sign-in/factor-one, the SSO callback) always stay Clerk's.
  const showClerk = clerk && ((rest?.length ?? 0) > 0 || want === "clerk" || (on !== true && want !== "password") || !owner);

  if (showClerk) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <SignIn />
        {owner && (
          <Link href={`/sign-in?with=password&redirect_url=${encodeURIComponent(redirectUrl)}`} className="text-xs text-ink-subtle underline underline-offset-2">
            Use your Ledgr password instead
          </Link>
        )}
      </main>
    );
  }

  if (owner) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <PasswordSignIn email={owner.email} redirectUrl={redirectUrl} />
        {clerk && (
          <Link href={`/sign-in?with=clerk&redirect_url=${encodeURIComponent(redirectUrl)}`} className="text-xs text-ink-subtle underline underline-offset-2">
            Sign in with Clerk instead
          </Link>
        )}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <p className="max-w-md text-sm text-neutral-500">
        {on === true
          ? "This copy of Ledgr uses password sign-in, but no password is set yet. At the computer running Ledgr, right-click the tray icon and choose Reset sign-in password."
          : "Sign-in is not set up on this copy of Ledgr (no Clerk key and no password). See runbook.md §1."}
      </p>
    </main>
  );
}
