// Getting the words out of a Pocket Casts episode, on this machine, for free.
//
// The same two roads as a YouTube video, cheapest first. Many shows publish
// their own transcript (Podcasting 2.0's <podcast:transcript>), and Pocket
// Casts lists it beside each episode: that is a few seconds of text, usually
// with the right spelling of every name. Only when there is none do we download
// the episode's audio and hand it to the same Whisper script YouTube uses.
//
// Everything comes from Pocket Casts' public, signed-out JSON, the same files
// its own web player reads. No account, no API key, no yt-dlp. Measured on the
// real endpoints 2026-10-12:
//   - a share link (pca.st/episode/<uuid>, or a short pca.st/<code>) answers
//     with a 302 to pocketcasts.com/podcast/<slug>/<podcast>/<slug>/<episode>
//   - /podcast/full/<podcast> lists every episode with its audio file address
//   - /mobile/show_notes/full/<podcast> lists every episode's transcripts
//     (application/srt or text/vtt), which vttToText already reads
//
// Every failure here becomes a sentence a person reads in their own item.
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { type FetchedTranscript, vttToText, whisperFile } from "./fetch";

const API = "https://podcast-api.pocketcasts.com";
const HOSTS = new Set(["pca.st", "www.pca.st", "pocketcasts.com", "www.pocketcasts.com", "play.pocketcasts.com"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const AUDIO_TIMEOUT_MS = 20 * 60_000;

/**
 * Is this a Pocket Casts address? Any path counts: whether it names one
 * episode is only knowable by following it, and a whole-show link gets one
 * readable failure line rather than being skipped forever in silence.
 */
export function isPocketCastsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return HOSTS.has(u.hostname.toLowerCase()) && u.pathname.length > 1;
  } catch {
    return false;
  }
}

/** The SQL twin of isPocketCastsUrl, for the query that finds waiting work. */
export const PODCAST_URL_SQL_PATTERN = String.raw`^https?://((www\.)?pca\.st|(www\.|play\.)?pocketcasts\.com)/.`;

/** The podcast and episode ids in a pocketcasts.com path, if it names an episode. */
export function episodeIds(url: string): { podcast: string; episode: string } | null {
  const ids = new URL(url).pathname.match(UUID);
  return ids && ids.length >= 2 ? { podcast: ids[0], episode: ids[ids.length - 1] } : null;
}

// Follow the share link's redirects by hand until an address names both ids.
// By hand because the final page is a web app that refuses non-browsers; only
// the Location headers on the way there are needed.
async function resolve(url: string): Promise<{ podcast: string; episode: string }> {
  let at = url;
  for (let hop = 0; hop < 5; hop++) {
    const ids = episodeIds(at);
    if (ids) return ids;
    const res = await fetch(at, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const next = res.headers.get("location");
    if (res.status === 404) throw new Error("Pocket Casts no longer has this episode");
    if (!next) break;
    at = new URL(next, at).toString();
  }
  throw new Error("this link is a whole show, not one episode; share the episode itself");
}

async function json(path: string): Promise<{ podcast?: { title?: string; episodes?: Episode[] } }> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Pocket Casts did not answer (${res.status})`);
  return res.json();
}

type Episode = {
  uuid: string;
  title?: string;
  url?: string;
  transcripts?: { url: string; type?: string }[];
};

/** The transcript of one Pocket Casts episode: the show's own if it has one, Whisper if not. */
export async function fetchPodcastTranscript(url: string): Promise<FetchedTranscript> {
  const { podcast, episode } = await resolve(url);
  const full = await json(`/podcast/full/${podcast}`);
  const ep = full.podcast?.episodes?.find((e) => e.uuid === episode);
  if (!ep) throw new Error("Pocket Casts no longer lists this episode");
  const title = [ep.title, full.podcast?.title].filter(Boolean).join(" | ") || undefined;

  // The show's own transcript. SRT and VTT differ only in a header and a comma,
  // and vttToText already takes both. A broken link here is not a failure: the
  // audio is still there for Whisper.
  const notes = await json(`/mobile/show_notes/full/${podcast}`).catch(() => null);
  const listed = notes?.podcast?.episodes?.find((e) => e.uuid === episode)?.transcripts ?? [];
  const caption = listed.find((t) => /vtt|srt/i.test(`${t.type} ${t.url}`));
  if (caption) {
    const res = await fetch(caption.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    const text = res?.ok ? vttToText(await res.text()) : "";
    if (text) return { text, source: "publisher", title };
  }

  if (!ep.url) throw new Error("this episode has no audio file to listen to");
  // One directory per episode, deleted whatever happens, so audio files never
  // quietly fill the disk.
  const dir = await mkdtemp(join(tmpdir(), "ledgr-pod-"));
  try {
    const file = join(dir, `audio${extname(new URL(ep.url).pathname) || ".mp3"}`);
    const res = await fetch(ep.url, { signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS) });
    if (!res.ok || !res.body) throw new Error(`the episode's audio could not be downloaded (${res.status})`);
    await pipeline(Readable.fromWeb(res.body as ReadableStream), createWriteStream(file));
    const text = await whisperFile(file, "this episode has no transcript and Whisper is not available on this machine");
    return { text, source: "whisper", title };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
