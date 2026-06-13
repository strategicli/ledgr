// Meeting prep panel (slice 24, PRD §5.1), rendered on a meeting canvas above
// the backlinks panel. Deterministic assembly: the related person's open
// tasks, the last few meetings with them, agenda headings, and the
// action-item -> task promotion. Server component; one getMeetingPrep call.
import Link from "next/link";
import { getMeetingPrep } from "@/lib/meetings/prep";
import PromoteTask from "./PromoteTask";

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const tsFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
      {children}
    </h3>
  );
}

export default async function MeetingPrep({
  ownerId,
  itemId,
}: {
  ownerId: string;
  itemId: string;
}) {
  const prep = await getMeetingPrep(ownerId, itemId);

  return (
    <section className="mx-auto w-full max-w-3xl px-12 pt-4">
      <div className="flex items-center gap-2">
        <SectionLabel>Meeting prep</SectionLabel>
        {prep.templateName && (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
            template: {prep.templateName}
          </span>
        )}
      </div>

      {prep.entities.length === 0 ? (
        <p className="mt-2 px-2 text-sm text-neutral-600">
          Relate a person or entity to see their open tasks and recent meetings here.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <div>
            <div className="px-2 text-xs text-neutral-500">
              With{" "}
              {prep.entities.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && ", "}
                  <Link href={`/items/${e.id}`} className="text-neutral-300 hover:underline">
                    {e.title || "Untitled"}
                  </Link>
                </span>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Open tasks ({prep.openTasks.length})</SectionLabel>
            {prep.openTasks.length === 0 ? (
              <p className="mt-1 px-2 text-sm text-neutral-600">No open tasks.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {prep.openTasks.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 px-2 text-sm">
                    <Link href={`/items/${t.id}`} className="text-neutral-300 hover:underline">
                      {t.title || "Untitled"}
                    </Link>
                    {t.dueDate && (
                      <span className="text-xs text-neutral-600">
                        due {dateFmt.format(t.dueDate)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionLabel>Recent meetings</SectionLabel>
            {prep.recentMeetings.length === 0 ? (
              <p className="mt-1 px-2 text-sm text-neutral-600">None yet.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {prep.recentMeetings.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-2 px-2 text-sm">
                    <Link href={`/items/${m.id}`} className="text-neutral-300 hover:underline">
                      {m.title || "Untitled"}
                    </Link>
                    {m.meetingAt && (
                      <span className="text-xs text-neutral-600">
                        {tsFmt.format(m.meetingAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="mt-4">
        <SectionLabel>Agenda</SectionLabel>
        <p className="mt-0.5 px-2 text-xs text-neutral-700">
          A default starting frame. Editable, per-meeting-type templates come
          later; for now, write your agenda in the note above.
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 px-2 text-sm text-neutral-500">
          {prep.agenda.map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <PromoteTask meetingId={itemId} />
      </div>
    </section>
  );
}
