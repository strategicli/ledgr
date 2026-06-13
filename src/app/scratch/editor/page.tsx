// M2 scratch route (ADR-038): the Tiptap markdown editor stood up in
// isolation. Owner-guarded like every other surface (the @-mention picker
// hits the owner-scoped /api/items), but it reads/writes only browser
// localStorage — no items table, no BlockNote path. Delete this route once the
// markdown editor is the real canvas (M4/M5).
import { redirect } from "next/navigation";
import { resolveOwner } from "@/lib/owner";
import ScratchEditorClient from "./ScratchEditorClient";

export const dynamic = "force-dynamic";

export default async function ScratchEditorPage() {
  const owner = await resolveOwner();
  if (!owner) redirect("/sign-in");

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Markdown editor (scratch)
        </h1>
        <p className="mt-1 mb-6 max-w-2xl text-sm text-neutral-500">
          M2: Tiptap stood up in isolation. <strong>Visual</strong> is the
          WYSIWYG (toolbar + shortcuts: Ctrl+B bolds, etc.);{" "}
          <strong>Markdown</strong> shows the raw canonical source you can edit
          directly. Toggle between them — colors and the mention should survive
          the round-trip either way.
        </p>
        <ScratchEditorClient />
      </div>
    </main>
  );
}
