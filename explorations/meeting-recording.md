# Exploration: meeting recording, transcription, and minutes

**Status:** ⭐ **Committed 1.0 item — design converged + Tyler pre-approved (2026-06-18).** Elevated from parked 2026-06-17; specced and approved this session. The Tasks Polish chunk is complete, so this is the next build chunk. **Several pieces touch CORE** (a new `transcription` provider seam, a schema touch for audio retention, and a Principle-3 interpretation); **Tyler has pre-approved all of it**, so the both-agree gate is satisfied — each core slice still gets an ADR in `decisions.md` at build time. See "Core flags" below. *(Was: parked, 2026-06-14; candidate, 2026-06-17.)*

## The idea

Attach (or paste) a transcript onto a meeting item, then have Claude turn it into minutes plus suggested tasks that land in the Inbox for triage, all within Ledgr, without a separate app.

## The converged shape (2026-06-18)

Five decisions from the design session reshaped this from "record + transcribe + summarize in-app" into something much smaller:

1. **The transcript is the pivot; audio is disposable.** The transcript is the artifact Ledgr keeps. Audio is just one (optional) way to produce it, and it gets purged.
2. **Upload-after-the-fact only for v1.** Brandon records on whatever device suits the moment (phone, QuickTime, Zoom local recording, Apple Voice Memos) and uploads. No in-app recording in v1. (See "Capture feasibility" for why.)
3. **Privacy is not a major risk factor** (Brandon's call). Hosted transcription APIs are acceptable; we don't need a local-only pipeline for v1.
4. **Processing (minutes + action items) is a Claude-over-MCP workflow, not an in-app LLM call** for v1. Ledgr makes no outbound Anthropic call; the intelligence lives in the Claude layer, fired manually or on a schedule, and reuses the MCP server already built (ADR-047/071).
5. **Cost is a non-issue.** The whole feature lands at single-digit dollars per month at Brandon's volume. Cost does not drive any choice here.

### v1a / v1b split

The split lets us prove the valuable part before touching any audio pipeline.

- **v1a (paste-first).** A Transcript panel on the meeting (paste plus edit), a "Transcripts awaiting minutes" saved view, minutes landing in the meeting body, suggested tasks landing in the Inbox related to the meeting. Processing is a Claude-over-MCP workflow Brandon fires manually or on a schedule. Almost no new app infrastructure: no outbound LLM call, no transcription service, no storage concern.
- **v1b (add convenience transcription).** The `transcription` provider seam plus one hosted adapter, audio upload with compress-on-ingest, and the retention purge. All deterministic plumbing. This is where the audio work and the storage work live.

## 1. Capture (upload-only for v1)

One entry point in v1: **upload after the fact.** Brandon records elsewhere and uploads an `audio/*` or `video/*` file to the meeting. This reuses the existing R2 presign flow (the same `/api/attachments` handshake image paste uses, ADR-040); it needs the content types allowed, a playback control, and (for v1b) the auto-transcribe trigger.

In-app recording (`MediaRecorder`, mic plus tab audio) is **deferred** (see "Deferred" and "Capture feasibility").

## 2. The transcript is the pivot

The transcript must be a **first-class, editable thing**, with audio-plus-transcription being just one optional way to fill it. Three roads, one destination:

- **Paste text** (primary path). Brandon transcribes locally (Apple Voice Memos and friends now do this for free), pastes the text, edits it, done. No audio ever touches R2.
- **Upload audio, Ledgr transcribes** (v1b convenience).
- **Record in-app** (deferred).

All three produce the same transcript. The "process with the LLM" step reads the transcript regardless of how it got there. A real consequence: **v1a ships with no transcription service at all.**

**Recommended storage:** the transcript lives as a child item of type `transcript` (a new bespoke type; `parent_id` = the meeting, reusing the subtask cascade so it travels with the meeting), surfaced inline on the meeting canvas via a **Transcript panel** so it edits in place without bloating the meeting's own body. (Alternative considered: a `## Transcript` region inside the meeting body. Rejected for v1 because a 20k-to-35k-word transcript would swamp the body editor and the human-facing doc.)

## 3. Storage: audio is transient, not content

3-hour meetings are large and would eat the ~10GB quota fast. The fix is to never treat audio as something Ledgr keeps. Three layers:

1. **Compress on ingest.** Transcode to Opus mono 16kHz before sending to the transcriber. Roughly 4-8x smaller (a 3-hour meeting drops from ~300MB to ~40MB). **This is not an accuracy or diarization concern:** Whisper-class models internally resample to 16kHz mono (it is their native input), and the voice characteristics that separate speakers sit below 8kHz, which 16kHz fully captures. The compression is applied to the in-flight copy sent to the API, not to what is stored, so the original is always available for a re-run. The compression target is a knob behind the transcription seam, defaulting to the safe profile. Deterministic plumbing, no model.
2. **Auto-purge keyed to the transcript.** Once a transcript exists and is confirmed, the audio has done its job. Mark it for deletion and let a daily cron remove it after N days (default ~30). Reuses the soft-delete plus purge machinery already in the app (the Trash 30-day purge), pointed at audio attachments, plus a "delete now" option.
3. **The paste path stores zero audio.** Given how often Brandon will transcribe locally and paste, the storage problem largely evaporates on its own.

Net: audio storage stops being a real constraint.

## 4. Transcription (v1b: the provider seam)

A new **`transcription` provider seam**, mirroring the existing storage/auth/tasks/calendar/mail/push seams (`src/lib/transcription/{types.ts, provider.ts, <adapter>.ts}`, env-selected, null-safe). Start with one hosted adapter; swap or add later without touching callers. Transcription is a deterministic, user-triggered API call (fine under Principle 3); only the summary is "AI on purpose."

**Recommended first adapter: AssemblyAI** (real bundled speaker diarization, takes 3-hour files by URL with no chunking, clean API), paired with the Claude-over-MCP summary step. **Fast-prototype alternative: Gemini 2.5 Flash**, which transcribes plus summarizes plus extracts action items in one call (least plumbing), at the cost of weaker prompt-based diarization and sending audio to Google.

**Avoid OpenAI** for this: it is the one major API with a hard 25MB / 25-minute cap, forcing chunking on long meetings. Everything else (Deepgram, AssemblyAI, Gemini) takes 9-to-10-hour files directly.

Auto-transcription **fires on upload completion** (the upload is the intent; no separate button, just a status indicator). Skip any time-based ("after 60s") trigger; it is arbitrary.

## 5. Processing: minutes + action items via Claude-over-MCP

The processing intelligence lives in the **Claude layer over the existing MCP/API**, not an in-app LLM call. Why this is the most Ledgr-native choice:

- **It defers the first outbound LLM call entirely.** No Anthropic key in the app, no summary seam, no model in Ledgr's backend. AI stays in the deliberate Claude layer, exactly where Principle 3 puts "AI on purpose."
- **It reuses the MCP server already built.** The 12 tools (ADR-047/071) are enough: find meetings with a transcript and no minutes, read the transcript, write minutes back, drop suggested tasks in the Inbox related to the meeting. No new tools strictly required; one saved view ("Transcripts awaiting minutes") makes the automation's query robust.
- **It satisfies "tweak the prompt" for free.** The prompt is the automation's instructions, which Brandon edits directly. No prompt-editor UI to build in v1.
- **It generalizes.** This becomes the blueprint for every future "AI on purpose" feature, not just meetings.

**Instant vs. scheduled:** the same workflow fires two ways. Schedule it (every half-day) for the passive path; fire it manually ("process my new transcripts") right after a meeting when instant minutes are wanted. No in-app button needed, because Brandon already lives in Claude.

**The human-in-the-loop safeguard:** the automation never silently commits. Minutes are drafts Brandon edits; suggested tasks land in the Inbox for triage (not auto-scheduled, not auto-completed). This is what keeps a scheduled automation consistent with Principle 3's intent (see Core flags).

## 6. Where things live (data model)

- **Transcript:** a child `transcript` item (`parent_id` = meeting), body = the markdown transcript. A new bespoke type (a `types` row; no schema change). Surfaced via the Transcript panel.
- **Minutes:** the meeting's own body (the human-facing doc), or a clearly-marked Minutes section. Fully editable.
- **Suggested tasks:** `task` items (or the `unmarked` catch-all), `inbox = true`, related to the meeting (and optionally to the meeting's people). Triaged from the Inbox. Associating each task back to the exact transcript paragraph is possible later via `block-linked-action-items.md`, but is overkill for v1 (Brandon's call).
- **"Needs minutes" signal:** a `properties.minutes` state on the meeting or transcript (`none` / `draft` / `done`), in the properties jsonb (no schema change). The "Transcripts awaiting minutes" view filters on it; the automation reads the view via MCP `run_view`.
- **Audio:** an `attachments` row with the file in R2, plus a retention timestamp (see Core flags) that the daily purge cron acts on.

## Cost (research 2026-06-18; verify before committing)

Volume assumption: one user, ~15-20 hrs of meetings/month, meetings up to 3 hrs.

| Service / model | $/hour | Diarization | Built-in summary | File limits |
|---|---|---|---|---|
| Self-hosted Whisper (own Mac/GPU) | $0 | Yes (pyannote) | No | None |
| Groq whisper-large-v3-turbo | $0.04 | No | No | 25MB upload / 100MB URL |
| Gemini 2.5 Flash | ~$0.10 | Prompt-based | **Yes, same call** | ~9.5 hr/request |
| AssemblyAI Universal-2 + diarization | $0.17 | Yes, bundled | Via LeMUR | 5GB / 10 hr |
| Deepgram Nova-3 + diarization | ~$0.38 | Yes, bundled | Separate | 2GB / 10 hr |
| OpenAI gpt-4o-transcribe | $0.36 | No (separate model) | No | **25MB / 25 min** |

A worst-case 3-hour meeting: ~$0.12 (Groq) to ~$1.13 (Deepgram with speakers). The LLM summary on top is trivial (a 3-hour transcript is ~40k input tokens: ~13 cents on Claude Sonnet 4.6, ~1 cent on Gemini Flash). **Realistic all-in: ~$2-8/month hosted, or ~$0 self-hosted.** Diarization, the assumed budget-buster, is ~2 cents/hour on AssemblyAI. Cost should not drive the decision; pick on diarization quality and pipeline simplicity.

## Capture feasibility (why upload-only for v1)

Recording mic plus computer audio in-app (Notion-style) is the one genuinely hard part, and it is why v1 is upload-only.

- **What a pure PWA can do:** mic plus browser-*tab* audio, mixed via the Web Audio API into one `MediaRecorder` track. As of Chrome 141 + macOS 14.2 it can even grab whole-system audio. So for a call held in a browser tab (Meet, Teams web, Zoom web) on a recent Chrome, the zero-install path genuinely works.
- **The catches:** it is checkbox-gated (miss the "share tab audio" box and you get silence with no error), Chromium-desktop only (Safari and all of iOS ignore display audio), and it cannot touch a native desktop app (Zoom/Teams desktop).
- **Why Notion can and a PWA cannot:** Notion's recorder is an Electron app calling macOS native audio APIs (ScreenCaptureKit / Core Audio taps). A sandboxed browser tab cannot call those, install a loopback device, or record silently. Matching Notion exactly means shipping a native/Electron companion, which cuts against Ledgr's PWA-first, few-dependencies posture (Principle 5).

So: upload-after-the-fact is the universal base (Brandon can find a recorder on every device). In-browser mic+tab recording is a possible later add for browser calls; full system-audio capture is a deliberate later choice that means a native helper.

## The two "free" tools (for the record)

Both are free because they run the model on your own hardware, not as a hosted service.

- **online-transcript-generator.com** runs Whisper entirely in the browser via WebGPU/WASM (Transformers.js). Audio never leaves the device. Catch: bound by your laptop's speed, a large one-time model download (up to 1.6GB), and no diarization. The browser-WASM trick is a real option behind the seam later (free, fully private) but too slow to be the default for multi-hour meetings.
- **github.com/homelab-00/TranscriptionSuite** is a self-hosted Electron + Docker stack wrapping faster-whisper / whisper.cpp / MLX, with pyannote diarization. "Free" = you run it on an Apple Silicon Mac or a cheap GPU box (cites ~30x realtime on an RTX 3060). A homelab project, not a product. This is the path if Brandon ever wants free + private + diarization on his own hardware.

## Core flags (Tyler pre-approved 2026-06-18; write the ADR at build time)

Per CLAUDE.md "Building together," these touch the core list. **Tyler has pre-approved all three**, so the both-agree gate is satisfied; each still gets an ADR in `decisions.md` when it is built:

1. **The `transcription` provider seam** (provider interfaces are core). Additive, mirrors the existing seams. ADR at build time.
2. **Audio retention schema touch** (schema.md is core). A nullable retention/`purge_after` column on `attachments` (or its metadata), set on transcript-confirm and acted on by the daily purge. ADR + migration.
3. **The Principle-3 interpretation** (the nine principles are core). A *scheduled* Claude automation brushes against Principle 3's "AI ... never in a cron job." The ratified reading: the principle keeps **Ledgr's own backend** model-free and predictable; an external Claude automation hitting the public MCP/API and producing **staged suggestions** (minutes as drafts, tasks in the Inbox, nothing auto-committed) honors the intent. The safeguard that keeps it clean is that the automation never silently commits. If Brandon ever wants it fully hands-off, that is a further decision. Capture this clarification in the ADR (it amends how Principle 3 reads).

Not core (move fast, solo at build time): the Transcript panel and meeting-canvas wiring (uses the existing canvas seam), the `transcript` type (a `types` row), the "Transcripts awaiting minutes" view, the compress-on-ingest plumbing, and the purge cron itself.

## Open questions

- Which first transcription adapter when v1b lands: AssemblyAI (structured diarization, Ledgr-shaped pipeline) or Gemini (one-call simplicity)? Leaning AssemblyAI.
- Retention window default: 30 days after confirm, or shorter? Should "confirm the transcript" be an explicit gesture, or is "a transcript exists" enough to start the countdown?
- Minutes location: meeting body vs. a `minutes` child item. Leaning meeting body.
- Does the automation create real `task` items or `unmarked` Inbox items for the suggested actions? (Ties to the catch-all capture default, ADR-072.)

## Deferred / later

- **In-app recording** (mic + tab audio for browser calls; system audio needs a native companion).
- **The in-app "process now" button** (Ledgr's first outbound LLM call, a `summarization` seam with editable prompt templates in Build). Only if the Claude-over-MCP path proves too indirect.
- **Client-side WASM Whisper** as a free, fully-private transcription adapter behind the seam.
- **Linking tasks to the exact transcript section** (`block-linked-action-items.md`).
- **Confidential handling** of recordings (ADR-075 declined a privacy tier for v1.0; revisit only if the privacy posture changes).

## Superseded notes (kept for the record)

The original framing had three co-equal sub-problems (recording, transcription, minutes) and an open question of whether to record in-app at all or call minutes generation through an MCP tool. The converged design answers those: upload-only for v1, transcript-as-pivot, and minutes via a Claude-over-MCP workflow rather than an in-app `generate_minutes` tool/call. PRD §4.15 (Whisper or Teams-transcript + Anthropic summary) remains the frozen-intent reference.
