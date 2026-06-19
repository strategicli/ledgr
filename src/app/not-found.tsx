// Root 404 (UX pass): replaces Next's bare default for any unmatched route.
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Not found</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-500">
          This page doesn&apos;t exist. It may have moved or been deleted.
        </p>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <Link href="/" className="text-neutral-400 hover:text-neutral-200">
          Home
        </Link>
        <Link href="/items" className="text-neutral-400 hover:text-neutral-200">
          All items
        </Link>
        <Link href="/trash" className="text-neutral-400 hover:text-neutral-200">
          Trash
        </Link>
      </div>
    </main>
  );
}
