// Action-item -> task promotion (slice 24, PRD §5.1). Turning a line in a
// meeting into a task: create the task, relate it to the meeting and to the
// meeting's confirmed people (so it shows up in that person's open tasks,
// which is exactly what next time's prep reads). Owner-scoped throughout.
import { createItem, getItem, ItemError } from "@/lib/items";
import { relateItems } from "@/lib/relations";
import { getMeetingPeople } from "./prep";

export async function promoteActionItem(
  ownerId: string,
  meetingId: string,
  title: string
) {
  const trimmed = title.trim();
  if (!trimmed) throw new ItemError("bad_request", "task title is required");

  // Ownership + existence (also gives the type for a friendlier guard).
  const meeting = await getItem(ownerId, meetingId);
  if (meeting.deletedAt) throw new ItemError("not_found", "meeting not found");

  const task = await createItem(ownerId, {
    type: "task",
    title: trimmed,
    status: "open",
    // It's a deliberate promotion, not an untriaged arrival (ADR-010).
    inbox: false,
  });

  // Relate task -> meeting (confirmed; it's a deliberate manual-equivalent
  // act), then task -> each of the meeting's people, so the task lands in
  // that person's open-task list. Edge failures (a since-deleted person)
  // don't undo the task.
  await relateItems(ownerId, task.id, meetingId);
  const people = await getMeetingPeople(ownerId, meetingId);
  for (const e of people) {
    try {
      await relateItems(ownerId, task.id, e.id);
    } catch {
      /* skip a person that can't be related; the task + meeting link stand */
    }
  }
  return task;
}
