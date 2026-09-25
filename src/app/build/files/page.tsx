// Build → Files (ADR-237; moved out of Data Hygiene same day at Tyler's call —
// files are DATA the owner browses, not a mess to clean). Every file in
// storage, the item it belongs to, a "not linked" mark when nothing points at
// it anymore, and Delete per row. The cleanup counterpart (orphaned bytes with
// no item at all) lives on Data Hygiene.
import AllFilesTool from "@/components/build/AllFilesTool";
import { getStorage, LocalDiskProvider, localDiskStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Where this install keeps file bytes, in one line, plus the one situation that
// would otherwise fail quietly: files saved to this computer's disk before the
// install switched to cloud storage. Those rows now point at a bucket that has
// never seen the bytes, so they won't open until someone copies them up.
async function storageNote(): Promise<{ where: string; stranded: number }> {
  const storage = getStorage();
  const local = localDiskStorage();
  if (!storage) return { where: "No file storage is set up on this install, so uploads are off.", stranded: 0 };
  if (storage instanceof LocalDiskProvider) {
    return { where: `Files are stored on this computer, in ${storage.root}.`, stranded: 0 };
  }
  const stranded = local
    ? (await local.listObjects("")).filter((o) => !o.key.startsWith("share-stash/")).length
    : 0;
  return { where: "Files are stored in cloud storage (Cloudflare R2).", stranded };
}

export default async function BuildFiles() {
  const note = await storageNote();
  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-12">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">
          Files
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Every file in your storage, the item it belongs to, and whether that
          item still points at it. Deleting a link out of a body never deletes
          the file — this is where you see what you actually have, and delete
          what you don&rsquo;t want.
        </p>
        <p className="mt-2 text-sm text-ink-subtle">{note.where}</p>
        {note.stranded > 0 && (
          <p className="mt-3 rounded-card border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            {note.stranded} file{note.stranded === 1 ? " is" : "s are"} still on this
            computer&rsquo;s disk from before this install switched to cloud storage.
            They won&rsquo;t open until they are copied into the bucket (runbook §1,
            &ldquo;Files on local disk&rdquo;).
          </p>
        )}
        <div className="mt-5">
          <AllFilesTool />
        </div>
      </div>
    </main>
  );
}
