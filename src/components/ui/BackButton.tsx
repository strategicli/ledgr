// A context-aware "Back" control. User Settings is reachable from both Work (the
// kebab) and Build (the sidebar), so a hardcoded destination would send a Build
// visitor to Work and vice-versa. Going back through browser history returns the
// user to wherever they actually came from. On a cold load (no in-app history)
// it falls back to a sensible route. Reusable anywhere a plain "← Back" belongs.
"use client";

import { useRouter } from "next/navigation";

export default function BackButton({
  fallback = "/",
  label = "← Back",
  className = "text-sm text-neutral-500 hover:text-neutral-300",
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        // history.length > 1 means there's an in-app page to return to; a fresh
        // tab / deep link has length 1, so use the fallback instead of leaving.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallback);
        }
      }}
      className={className}
    >
      {label}
    </button>
  );
}
