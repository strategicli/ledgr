# Exploration: meeting recording, transcription, and minutes

**Status:** parked (Brandon, 2026-06-14). Not intent, not a decision.

## The idea

Attach audio or video to a meeting item, transcribe it, and derive a structured minutes document from the transcript — all within Ledgr, without requiring a separate app.

## Three sub-problems

### 1. Recording or file upload

Two entry points:
- **Upload after the fact.** The user records on their phone (Voice Memos, Teams, Zoom, etc.) and uploads the file to the meeting item in Ledgr. This is an attachment — same R2 presign flow the image paste feature uses; just needs `audio/*` and `video/*` content types allowed and a playback control on the canvas.
- **Record in-app.** Ledgr opens the browser's `MediaRecorder` API, streams to R2 in chunks, and attaches the file to the meeting when done. Workable on modern mobile browsers but adds complexity (recording state, chunked upload, permissions). Lower priority than upload.

### 2. Transcription

Audio → text. Options:
- **OpenAI Whisper (or Azure Speech) via an API call.** Send the audio file to a transcription endpoint, get back a timestamped transcript. Fits rule 3 (deterministic, no model in the loop for the transcript itself — just a call to a speech-to-text service). A Vercel serverless route can proxy the call; the transcript is stored as a `{format:"markdown", text}` body or as a separate `transcription` property/attachment.
- **Browser-native `SpeechRecognition`.** Works offline, no cost, but accuracy is lower and it's live-only (can't process an uploaded file after the fact). Useful as a fast in-meeting capture but not for uploaded recordings.
- **Constraint (rule 3 + rule 5):** transcription must stay a one-shot deterministic transform, not a cron job or autonomous process. Brandon taps "Transcribe" → the call fires → transcript lands. No silent background processing.

### 3. Minutes generation

Transcript → structured document. This is the one step that genuinely benefits from a model:
- A Claude MCP tool call: `generate_minutes(transcript)` → returns a structured markdown document (attendees, decisions, action items, summary).
- This is squarely **AI on purpose (rule 3)** — a deliberate human-in-the-loop action, not a silent cron.
- The generated minutes land in the meeting item's body (or as a separate "Minutes" child item), fully editable.
- Action items in the minutes can be promoted to tasks via the block-linked action-item mechanism (`explorations/block-linked-action-items.md`).

## Constraints

- **R2 storage.** Audio/video files can be large; user quota (~10 GB per rule) applies. Chunked upload and storage cost need watching.
- **Rule 3 (deterministic by default, AI on purpose).** Transcription is a deterministic API call (fine). Minutes generation via Claude is deliberate and human-triggered (fine). Neither should run automatically on meeting create.
- **Rule 4 (Sunday-proof).** Meeting minutes need to be accessible offline. The finished markdown body should be pinned to the SW cache the same way any canvas body is; the audio file itself doesn't need to be offline.
- **Rule 8 (fast for the user, cheap on the back end).** Transcription of a 1-hour meeting can be slow; use a background route with a status poll or a webhook, not a synchronous response.

## Open questions

- Which transcription service? Whisper API (OpenAI), Azure Speech (already in-stack via Microsoft), or something else?
- Should transcripts be stored as a child item (type = `transcript`) or as a body/attachment on the meeting item itself? A child item keeps the meeting body clean; an attachment is simpler.
- How does the MCP tool surface minutes generation? A tool called `generate_meeting_minutes(item_id)` that reads the transcript attachment and writes back to the item's body (or creates a child) seems right.
- Does Brandon want to record inside Ledgr at all, or is upload-after-the-fact sufficient to start?
