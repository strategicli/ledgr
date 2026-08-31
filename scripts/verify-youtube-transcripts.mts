// Verifies the YouTube transcript job's pure decisions: what counts as a YouTube
// address, what a caption file turns into, and the two body shapes written back.
//
// The round trip at the bottom is the one that matters. The marker in the body
// is the ONLY thing standing between this feature and a machine that transcribes
// the same video every ten minutes forever, so both bodies the job can write —
// the success and the failure — must be recognized by the same test that decides
// what is still waiting. Pure: no DB, no network, nothing spawned.
//   npx tsx scripts/verify-youtube-transcripts.mts
import { vttToText } from "../src/lib/youtube/fetch";
import {
  hasTranscriptMarker,
  isYoutubeVideoUrl,
  withFailure,
  withTranscript,
} from "../src/lib/youtube/transcripts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// ── The caption file ────────────────────────────────────────────────────────
// Copied off a real YouTube auto-caption track, not invented: the rolling first
// line that repeats the cue before it, the per-word <00:00:04.799><c> timing
// tags, the `align:start position:0%` cue settings, the near-empty spacer cues,
// and a [Music] token.
const AUTO_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:04.390 align:start position:0%

[Music]

00:00:04.390 --> 00:00:04.400 align:start position:0%



00:00:04.400 --> 00:00:06.869 align:start position:0%

This<00:00:04.799><c> is</c><00:00:04.960><c> a</c><00:00:05.200><c> three.</c><00:00:05.920><c> It's</c><00:00:06.080><c> sloppily</c><00:00:06.640><c> written</c>

00:00:06.869 --> 00:00:06.879 align:start position:0%
This is a three. It's sloppily written


00:00:06.879 --> 00:00:08.549 align:start position:0%
This is a three. It's sloppily written
and<00:00:07.120><c> rendered</c><00:00:07.440><c> at</c><00:00:07.839><c> an</c><00:00:08.320><c> extremely</c><00:00:08.320><c> low</c>
`;

const text = vttToText(AUTO_VTT);

check("reads as one clean line of prose", text === "This is a three. It's sloppily written and rendered at an extremely low");
check("keeps no cue timings", !/-->|\d{2}:\d{2}:\d{2}/.test(text));
check("keeps no inline tags", !/<[^>]+>/.test(text));
check("keeps no WEBVTT header", !/WEBVTT|Kind:|Language:/.test(text));
check("drops the standalone [Music] cue", !text.includes("[Music]"));
// The rolling repeat is the whole reason this function exists: without the
// duplicate check the sentence below appears twice.
check("says each sentence once", text.split("This is a three").length === 2);

// Entities and a long pause: the pause starts a new paragraph, the entity decodes.
const PAUSED_VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Bread &amp; butter

00:00:20.000 --> 00:00:22.000
then a new thought
`;
const paused = vttToText(PAUSED_VTT);
check("decodes HTML entities", paused.includes("Bread & butter"));
check("breaks a paragraph on a long silence", paused.includes("\n\n"));
check("survives an empty file", vttToText("") === "" && vttToText("WEBVTT\n") === "");

// ── The address test ────────────────────────────────────────────────────────
check("youtu.be share links", isYoutubeVideoUrl("https://youtu.be/dQw4w9WgXcQ"));
check("music.youtube.com", isYoutubeVideoUrl("https://music.youtube.com/watch?v=abc"));
check("m.youtube.com", isYoutubeVideoUrl("https://m.youtube.com/watch?v=abc"));
check("www.youtube.com", isYoutubeVideoUrl("https://www.youtube.com/watch?v=abc"));
check("host casing does not matter", isYoutubeVideoUrl("https://WWW.YouTube.com/watch?v=abc"));
check("a plain article is not one", !isYoutubeVideoUrl("https://example.com/posts/youtube-is-great"));
// A host that merely ENDS in youtube.com is somebody else's domain.
check("a lookalike host is not one", !isYoutubeVideoUrl("https://notyoutube.com/watch?v=abc"));
check("an empty string is not one", !isYoutubeVideoUrl(""));
check("junk is not one, and does not throw", !isYoutubeVideoUrl("::: not a url :::"));
check("null and undefined are not one", !isYoutubeVideoUrl(null) && !isYoutubeVideoUrl(undefined));
check("shorts are videos", isYoutubeVideoUrl("https://www.youtube.com/shorts/abc123def"));
check("a live url is a video", isYoutubeVideoUrl("https://www.youtube.com/live/abc123def"));
check("an embed is a video", isYoutubeVideoUrl("https://www.youtube.com/embed/abc123def"));
check("extra query params are fine", isYoutubeVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=42"));
// THE ONE THAT COST US A REAL FAILURE (2026-08-31). Handed a channel page,
// yt-dlp starts enumerating the whole channel and never finishes inside a
// timeout, so one saved channel page burned ten minutes and then wrote "took
// too long to fetch" into an item that was never transcribable to begin with.
check("an @handle channel page is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/@JesseEnkamp"));
check("a /c/ channel page is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/c/JamesGrage"));
check("a /channel/ page is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/channel/UCabcdefghij"));
check("a /user/ page is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/user/someone"));
check("a playlist is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/playlist?list=PLabcdef"));
check("a bare youtube.com is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/"));
check("/watch with no v is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/watch"));
check("the results page is NOT a video", !isYoutubeVideoUrl("https://www.youtube.com/results?search_query=karate"));

// ── The marker ──────────────────────────────────────────────────────────────
check("finds the marker", hasTranscriptMarker("x\n<!-- transcript:captions 2026-08-30 -->\ny"));
check("no marker in a plain body", !hasTranscriptMarker("[A video](https://youtu.be/x)"));
check("no marker in an empty body", !hasTranscriptMarker("") && !hasTranscriptMarker(null));

// ── The two bodies the job writes ───────────────────────────────────────────
const BODY = "[A video](https://youtu.be/dQw4w9WgXcQ)";
const ok = withTranscript(BODY, { text: "Hello there.", source: "captions", date: "2026-08-30" });

check("keeps what the item already said", ok.startsWith(BODY));
check("puts the transcript under its own heading", ok.includes("\n\n## Transcript\n"));
check("records the source and the date", ok.includes("<!-- transcript:captions 2026-08-30 -->"));
check("blank line before the transcript text", ok.includes("2026-08-30 -->\n\nHello there."));
check("names whisper when whisper did it", withTranscript(BODY, { text: "hi", source: "whisper", date: "2026-08-30" }).includes("transcript:whisper"));
check("an empty body gains no leading blank line", withTranscript("", { text: "hi", source: "captions", date: "2026-08-30" }).startsWith("## Transcript"));

const bad = withFailure(BODY, "the video is private or removed", "2026-08-30");
check("a failure keeps what the item already said", bad.startsWith(BODY));
check("a failure records that it failed, and when", bad.includes("<!-- transcript:failed 2026-08-30 -->"));
check("a failure says why, where a person will see it", bad.includes("> Transcript unavailable: the video is private or removed"));
// An HTML comment runs to the next blank line, so without this the quote would
// be swallowed into the comment and the reader would see nothing at all.
check("the reason is not swallowed by the comment", bad.includes("-->\n\n> Transcript"));
check("a failure adds no Transcript heading", !bad.includes("## Transcript"));

// THE ROUND TRIP. Both bodies must read as "already handled", or the job does
// this video again, and again, and again.
check("a transcribed body is never picked up twice", hasTranscriptMarker(ok));
check("a failed body is never picked up twice", hasTranscriptMarker(bad));

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
