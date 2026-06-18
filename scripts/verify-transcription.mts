// Meeting recording v1b verification (ADR-088): the transcription seam. Pure —
// no DB, no live key. Covers the AssemblyAI response→result mapping (queued /
// processing / completed-with-diarization / error / unknown-status tolerance),
// the transcript→markdown formatter (diarized vs plain), and the null-safe,
// env-selected provider selection (unconfigured → none/null; key → assemblyai;
// explicit none disables). A live submit/poll needs a real audio URL + key, so
// it's left to the in-browser eyeball (the graph-auth gated posture).
// Run: npx tsx scripts/verify-transcription.mts
const { mapTranscriptResponse } = await import("../src/lib/transcription/assemblyai");
const { transcriptToMarkdown } = await import("../src/lib/transcription/types");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

// --- response mapping -----------------------------------------------------
const queued = mapTranscriptResponse({ id: "j1", status: "queued" });
check("queued → status queued, text null", queued.status === "queued" && queued.text === null && queued.segments.length === 0 && queued.error === null);

const processing = mapTranscriptResponse({ id: "j1", status: "processing" });
check("processing → status processing", processing.status === "processing" && processing.text === null);

const unknown = mapTranscriptResponse({ id: "j1", status: "something_new" });
check("unknown status → processing (tolerant, keep polling)", unknown.status === "processing");

const completed = mapTranscriptResponse({
  id: "j1",
  status: "completed",
  text: "Hello there. General Kenobi.",
  utterances: [
    { speaker: "A", start: 0, end: 1200, text: "Hello there." },
    { speaker: "B", start: 1300, end: 2500, text: "General Kenobi." },
  ],
});
check("completed → status completed + text", completed.status === "completed" && completed.text === "Hello there. General Kenobi.");
check("completed → diarized segments mapped", completed.segments.length === 2 && completed.segments[0].speaker === "A" && completed.segments[1].text === "General Kenobi." && completed.segments[1].start === 1300);
check("completed → no error", completed.error === null);

const errored = mapTranscriptResponse({ id: "j1", status: "error", error: "bad audio" });
check("error → status error + message", errored.status === "error" && errored.error === "bad audio" && errored.text === null);

const noUtterances = mapTranscriptResponse({ id: "j1", status: "completed", text: "Just text." });
check("completed w/o utterances → empty segments, text kept", noUtterances.segments.length === 0 && noUtterances.text === "Just text.");

// --- markdown formatting --------------------------------------------------
const md = transcriptToMarkdown(completed);
check("diarized → Speaker-labeled markdown paragraphs", md === "**Speaker A:** Hello there.\n\n**Speaker B:** General Kenobi.", JSON.stringify(md));
const mdPlain = transcriptToMarkdown(noUtterances);
check("no diarization → plain text", mdPlain === "Just text.", JSON.stringify(mdPlain));

// --- null-safe, env-selected provider selection ---------------------------
// transcriptionAdapter() reads env live on every call (pure, no cache), so it
// covers every permutation directly. getTranscription() caches its instance and
// never caches a miss, so test it null-first then configured (the real lifecycle).
const { transcriptionAdapter, getTranscription } = await import("../src/lib/transcription/provider");

delete process.env.TRANSCRIPTION_ADAPTER;
delete process.env.ASSEMBLYAI_API_KEY;
check("unconfigured → adapter none", transcriptionAdapter() === "none");
check("unconfigured → getTranscription null", getTranscription() === null);

process.env.ASSEMBLYAI_API_KEY = "test-key";
check("key set → adapter assemblyai", transcriptionAdapter() === "assemblyai");
const prov = getTranscription();
check("key set → getTranscription non-null + id", !!prov && prov.id === "assemblyai");

process.env.TRANSCRIPTION_ADAPTER = "none";
check("explicit TRANSCRIPTION_ADAPTER=none → adapter none", transcriptionAdapter() === "none");

process.env.ASSEMBLYAI_API_KEY = "";
delete process.env.ASSEMBLYAI_API_KEY;
check("cleared key → adapter none again", transcriptionAdapter() === "none");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
