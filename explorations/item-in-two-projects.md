# An item in two projects

Raised by Brandon, 2026-08-28. Open. Needs both-agree + an ADR if we change
`home` semantics.

## What Brandon wants

A task (or note, or meeting) that genuinely belongs to two projects, showing up
in both projects' cards. Today attaching it to a second project takes it out of
the first.

## What the code actually does today

Three facts, because they are easy to get backwards.

1. **`home` is singular and enforced.** `setHome` (src/lib/relations.ts:366)
   calls `clearHomeEdges` first, and a partial unique index
   (`relations_one_home_per_source_uq`) makes a second home edge fail the
   insert. ADR-138 / PJ1 (2026-06-29, decisions.md:1816) states it: "a record
   has at most one home parent".

2. **The collection cards do not use `home`.** Tyler changed this three days
   after PJ1 landed (src/lib/record-widgets.ts:240-248, 2026-07-01): "the box
   should pull anything of that type that is associated with the project",
   role- and home-agnostic. `relatedHome` now only gates the generic Related
   Records box and the Pursuit roll-up.

3. **The dual edge is already written in production.** A note jotted on a
   meeting keeps the meeting as its home and gets a plain `contains` edge to
   the meeting's project so it shows in that project's Docs box
   (src/app/api/records/[id]/contain/route.ts, 2026-07-01). decisions.md:2606
   says it out loud: "a plain `relate_items` was already enough to make a task
   appear in a project's Tasks card. Home is what makes it live there."

So showing an item in two projects' cards **already works**. The only thing
stopping it is that our "attach to a project" write path uses `setHome`, which
evicts the previous home. That is a UI choice, not a schema wall.

## Was one-home deliberate?

Partly. PJ1's "Why / alternatives" paragraph argues four other choices and
never defends the singularity. What it does do, in the same sentence, is carve
out the escape hatch: `home=false` is "surfaced-elsewhere". ADR-001 lists
"single-parent containment" as a settled premise with no argument.

Read plainly: **home was deliberately singular by definition (a "primary
residence"), and multi-placement was deliberately routed to non-home edges.**
"An item can only be in one project" is a consequence of which write path the
UI happens to call, not a decision anyone defended.

The one design that would have needed a single home is the OneDrive export
folder layout. `explorations/storage-organization.md:30` still lists it as
open: "what is each item's one canonical path, given it can have many
relations?" The shipped export never answered it. Paths are `type/year/name`
(src/lib/export/engine.ts:328), completely indifferent to containment.

## What still depends on a single home

Ordered by how much it would hurt.

| Depends on it | Where | What happens with two |
|---|---|---|
| **Project completion sweep** | src/lib/project-completion.ts:14,99 | The real risk. Completing project A would close tasks that also live in B. decisions.md:3359 draws the line deliberately: "scope is containment, not association". |
| DB invariant | the partial unique index | A second home edge fails the insert. Hard blocker, but only for a true second *home*. |
| Activity log subject | src/lib/activity.ts:63 (`homeParentOf`, `.limit(1)`) | A completed task narrates one arbitrary project; the other project's activity silently misses it. |
| Next Action auto-advance | src/lib/item-mutations.ts:695 | Could advance the wrong project's pinned Next Action. |
| Breadcrumb / project chip | src/components/tasks/TaskListRow.tsx:118 | Picks the first home edge. Arbitrary, degrades rather than breaks (there is already a non-home fallback). |
| Parent breadcrumb map | src/lib/task-row-meta.ts:117 | Keyed one parent per child; a second row silently overwrites. |
| Digest milestone lookup | src/lib/digest/notify.ts:64 | Would ping both projects. Probably wanted, currently undecided. |
| Pursuit roll-up | src/lib/record-widgets.ts:156 | A project in two pursuits counts in both. |

Not affected: the export path (see above), progress/points rollups (already
association-wide, already double-counts a related task today), the project
markdown projection (ADR-197) and the project timeline (ADR-198), which both
use the same home-agnostic association the cards use.

## The two models

**A. Primary plus secondary (cheap).** Keep one home. A second project gets a
plain `contains` edge with `home=false`. The item shows in both cards. The
first project keeps the breadcrumb, the activity narration, Next Action
eligibility, and the completion sweep. No migration, no index change, no ADR
strictly required, since it is the meeting-note pattern applied on purpose.

The honest cost: the second project is visibly a lesser member. Complete
project B and the shared task is untouched. Whether that reads as correct or
as a bug depends on what Brandon means by "belongs to both".

**B. Peer memberships (real work).** Drop the singularity. Every row in the
table above needs an answer, and the completion sweep needs a rule: does
completing A close a task that also lives in B, ask, or skip it? Needs a
migration, an ADR, and probably a "primary" tiebreak anyway for breadcrumbs and
activity, which starts to look like model A wearing a different hat.

## The question for Tyler

1. Was one-home a decision you would defend, or the path of least resistance
   while building PJ1? (The ADR does not say, so only you know.)
2. If we ship model A, does a `home=false` second project bother you, given you
   already use exactly that edge for meeting notes?
3. If we ship model B, what should the completion sweep do with a task that
   lives in two projects? That is the only place we found where loosening
   `home` could destroy data rather than just confuse a label.
4. Anything you built downstream that assumes one home and is not in the table
   above?

Also worth knowing: several code comments cite **ADR-111** for containment
(relations.ts:333, views.ts:52, item-mutations.ts:695). ADR-111 is the
dashboard canvas ADR. The containment decision is ADR-138 / PJ1. Harmless, but
it sent this investigation down a wrong path for a while.
