// Transcription-provider selection (meeting recording v1b, ADR-088). Returns
// null when transcription isn't configured, so the paste path (v1a) and the
// whole app work without it — audio upload + auto-transcribe simply isn't
// offered. Mirrors getStorage()'s null-safety and tasksAdapter()'s pure id.
//
// Enabled by the presence of an ASSEMBLYAI_API_KEY (the deliberate opt-in, like
// the R2 vars enabling storage). TRANSCRIPTION_ADAPTER selects among adapters
// (default "assemblyai") and can be set to "none" to disable even with a key.
import { AssemblyAIProvider } from "./assemblyai";
import type { TranscriptionProvider } from "./types";

export type {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
  TranscriptionStatus,
  TranscriptSegment,
} from "./types";
export { transcriptToMarkdown } from "./types";

export type TranscriptionAdapterId = "none" | "assemblyai";

// The active adapter id (pure, env-only) — shared by getTranscription, /health,
// and verify scripts so "which adapter is active" has one source of truth.
export function transcriptionAdapter(): TranscriptionAdapterId {
  const id = (process.env.TRANSCRIPTION_ADAPTER ?? "assemblyai").toLowerCase();
  if (id === "assemblyai" && process.env.ASSEMBLYAI_API_KEY) return "assemblyai";
  return "none";
}

let cached: TranscriptionProvider | null = null;

export function getTranscription(): TranscriptionProvider | null {
  if (cached) return cached;
  // A miss isn't cached: config may arrive later (env set between dev restarts,
  // a test injecting a key).
  if (transcriptionAdapter() !== "assemblyai") return null;
  cached = new AssemblyAIProvider(process.env.ASSEMBLYAI_API_KEY!);
  return cached;
}
