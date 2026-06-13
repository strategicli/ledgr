# Module: Sermons & Lessons

**Status:** Draft v0.1
**Builds on:** PRD §3.6/§3.7, §4.15 (meeting capture + AI, reused for delivery transcripts)
**Canonical body format:** markdown (with light bold/highlight — within markdown's reach via the existing inline-HTML encoding)
**Priority:** 4th module — deliberately last of the four; benefits from Savor + passage entities maturing first

---

## What it's for

The sermon/lesson workflow, which by Tyler's own description is **much less structured** than papers — and that's fine, the module matches the looseness rather than imposing a paper-style pipeline. The shape is light on purpose.

## The real workflow (don't over-structure it)

1. **Notes doc** — one catch-all per sermon where everything useful lands: study notes, helpful material, ideas, applications as they occur. Loose by nature.
2. **Robust outline** — essentially all the content in outline form, but *not* a full manuscript. This is the main artifact.
3. **Delivery transcript** (aspirational) — record the actual delivery, save the transcript, attach it to the sermon.
4. Light formatting only — minor highlights and bolding, nothing like sermon-color-heavy needs. (So markdown-canonical is fine here; no need for BlockNote-canonical.)

## Entities & shape

**`sermon`** (system type; `lesson` is the same type with a sub-flag or a sibling type — decide at build):
- `title`, `body` (markdown — the robust outline)
- properties: `passage` (primary text), `date_preached`, `venue`, `stage` (study → outline → delivered)
- a **notes** section/sub-item (the catch-all) — markdown section in body or a linked `note`, decide at build
- relations: → `passage` entities (primary + cross-refs), → a `series` entity (below), → delivery transcript

**`series`** (entity kind, or reuse `topic`/`project`):
- Groups sermons/lessons. "This Savor study on Hebrews could become a series" is the query that makes series-as-entity worth it. Tyler has existing series to capture and sees more series work ahead.

**Delivery transcript:**
- Audio recorded → stored as an **attachment** (your §4.15 model exactly: audio is just an attachment). Transcript + optional summary become sections or a linked item.
- Reuses your §4.15 pipeline wholesale — no new infrastructure. Manual path (Voice Memos transcript → paste via MCP → summary written back) is the zero-cost v1; automated Whisper+API is the later option, same as your spec.

## Lessons specifics

Lessons (Sunday school, small group) **share the type** but may add optional fields: `handout` (linked doc/render), `discussion_questions`. Light additions, not a separate pipeline.

## Migration

Tyler has **many existing sermon files in Word docs** to move over eventually. These import as markdown (pandoc the other direction: .docx → markdown), each linked to its passage and series. Bulk, not urgent — a batch job once the type exists.

## Why this is 4th, not 2nd

No active deadline, and it gets *better* if built after Savor integration and passage entities are mature — because the highest-value sermon feature is "pull my Savor commentary on this passage into sermon prep," which depends on those existing. Building it last means it inherits the richest possible Scripture-linked context.

## Open questions

1. `lesson` as sub-flag of `sermon` vs sibling type — decide at build (depends how different handouts/discussion-questions make the canvas).
2. Notes catch-all as body-section vs linked item — decide at build.
3. Transcript: stored in the sermon's markdown vs separate linked item — Tyler flagged both as acceptable; likely separate linked item so the outline stays clean.
