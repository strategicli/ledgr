// A plain landing page for a Build/Maintain section whose tool isn't built yet
// (ADR-063). The route + sidebar entry are real (so the sidebar never dead-links);
// the body is the section title plus a one-paragraph note of the *plan*, so
// future-you / Brandon / Claude Code knows the intent when the tool gets built.
import { type ReactNode } from "react";

export default function BuildStub({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          {title}
        </h1>
        <div className="mt-4 rounded-xl border border-dashed border-neutral-800 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            Planned
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-400">
            {children}
          </p>
        </div>
      </div>
    </main>
  );
}
