// Transcription-provider interface (meeting recording v1b, ADR-088; CLAUDE.md
// provider-interface discipline). Ledgr talks to this, never to a transcription
// API directly, so the adapter can be swapped (AssemblyAI → Deepgram → a local
// WASM Whisper) without touching callers, and a future local build is a
// packaging exercise. Transcription is a deterministic, user-triggered API call
// (fine under Principle 3 — only the *minutes* are "AI on purpose"); the model
// in the loop here is a speech-to-text service, not a reasoning step.
//
// Async by nature: long meetings transcribe over minutes, so the seam is a
// submit + poll job model (a serverless request can't block that long). The
// caller submits on audio upload and polls from a cron/status check.

export type TranscriptionStatus = "queued" | "processing" | "completed" | "error";

// One diarized utterance. `speaker` is a provider label ("A", "B", …) or null
// when diarization is off/unavailable. Times are milliseconds from the start.
export type TranscriptSegment = {
  speaker: string | null;
  start: number;
  end: number;
  text: string;
};

export type TranscriptionResult = {
  jobId: string;
  status: TranscriptionStatus;
  // The full transcript text when completed, else null.
  text: string | null;
  // Diarized utterances when available (empty otherwise).
  segments: TranscriptSegment[];
  // A provider error message when status is "error", else null.
  error: string | null;
};

export type TranscriptionOptions = {
  // Ask for speaker diarization (the reason AssemblyAI is the first adapter).
  diarize?: boolean;
};

export interface TranscriptionProvider {
  // Stable id, surfaced on /health and the AI & MCP page.
  id: string;
  // Submit audio (by public URL — adapters take long files by URL, no
  // chunking) for transcription; returns the provider's job id.
  submit(audioUrl: string, opts?: TranscriptionOptions): Promise<{ jobId: string }>;
  // Poll a submitted job for its current status/result.
  poll(jobId: string): Promise<TranscriptionResult>;
}

// Render a finished transcript as readable markdown for the transcript body:
// diarized utterances become "**Speaker A:** …" paragraphs; without speakers,
// the plain text. Pure (no provider), so the upload-completion path and the
// verify script share one formatter.
export function transcriptToMarkdown(result: TranscriptionResult): string {
  if (result.segments.length > 0) {
    return result.segments
      .map((s) =>
        s.speaker ? `**Speaker ${s.speaker}:** ${s.text.trim()}` : s.text.trim()
      )
      .join("\n\n");
  }
  return (result.text ?? "").trim();
}
