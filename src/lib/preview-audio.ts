// An item's preview track: one audio attachment the item points at through
// properties.previewAudio (the attachment id). Set today by the song canvas
// ("Preview track"), read by the share page, which plays it above the chart so
// a shared song carries both the chords and a recording of it. The file is an
// ordinary attachment on the item, so a share link's token already grants it
// (files/[id] scopes a token to its parent item) and revoking the link revokes
// the track with the page.
export const PREVIEW_AUDIO_KEY = "previewAudio";

export function previewAudioId(properties: unknown): string | null {
  if (typeof properties !== "object" || properties === null) return null;
  const v = (properties as Record<string, unknown>)[PREVIEW_AUDIO_KEY];
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null;
}
