// Root error boundary (UX pass): a DB hiccup or render throw used to hit Next's
// bare default error screen. This catches errors in any child route segment and
// offers a retry (reset re-renders the segment) plus a way home. Errors in the
// root layout itself aren't caught here (they'd need global-error.tsx); the
// layout is intentionally thin, so this covers the pages.
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it (Principle 9: no silent failures); the digest correlates with
    // the server log entry.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">
          Something went wrong
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
          This page hit an error. Try again, or head back home. If it keeps
          happening, the server log has the details.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
