// AssemblyAI transcription adapter (meeting recording v1b, ADR-088). Chosen
// first adapter: real bundled speaker diarization, takes long files by URL with
// no chunking, clean REST API. Two calls — POST a transcript job with the audio
// URL, GET it until completed. No SDK dependency (Principle 5): plain fetch over
// ~30 lines, the web-push / aws4fetch precedent.
//
// The response→result mapping is a pure function (mapTranscriptResponse) so the
// shape handling is node-testable with fixtures, no live key needed (the
// graph-auth verify pattern).
import type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptSegment,
} from "./types";

const API_BASE = "https://api.assemblyai.com/v2";

// AssemblyAI's transcript object (the fields we read). status is one of
// queued/processing/completed/error; utterances carry diarization when
// speaker_labels was requested.
type AaiTranscript = {
  id: string;
  status: string;
  text?: string | null;
  error?: string | null;
  utterances?: { speaker?: string | null; start?: number; end?: number; text?: string }[] | null;
};

// Pure map from AssemblyAI's transcript JSON to our result. Tolerant: unknown
// status collapses to "processing" (keep polling) rather than throwing, and
// missing utterances → no segments.
export function mapTranscriptResponse(raw: unknown): TranscriptionResult {
  const t = (raw ?? {}) as AaiTranscript;
  const status: TranscriptionResult["status"] =
    t.status === "completed"
      ? "completed"
      : t.status === "error"
        ? "error"
        : t.status === "queued"
          ? "queued"
          : "processing";
  const segments: TranscriptSegment[] = Array.isArray(t.utterances)
    ? t.utterances.map((u) => ({
        speaker: u.speaker ?? null,
        start: typeof u.start === "number" ? u.start : 0,
        end: typeof u.end === "number" ? u.end : 0,
        text: u.text ?? "",
      }))
    : [];
  return {
    jobId: String(t.id ?? ""),
    status,
    text: status === "completed" ? (t.text ?? "") : null,
    segments,
    error: status === "error" ? (t.error ?? "transcription failed") : null,
  };
}

export class AssemblyAIProvider implements TranscriptionProvider {
  readonly id = "assemblyai";

  constructor(private apiKey: string) {}

  private headers(): Record<string, string> {
    return { Authorization: this.apiKey, "Content-Type": "application/json" };
  }

  async submit(
    audioUrl: string,
    opts?: TranscriptionOptions
  ): Promise<{ jobId: string }> {
    const res = await fetch(`${API_BASE}/transcript`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        audio_url: audioUrl,
        // Diarization on by default — it's why this adapter was chosen.
        speaker_labels: opts?.diarize !== false,
      }),
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI submit failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("AssemblyAI submit returned no job id");
    return { jobId: json.id };
  }

  async poll(jobId: string): Promise<TranscriptionResult> {
    const res = await fetch(`${API_BASE}/transcript/${jobId}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI poll failed (${res.status}): ${await res.text()}`);
    }
    return mapTranscriptResponse(await res.json());
  }
}
