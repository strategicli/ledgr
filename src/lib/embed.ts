// A web address -> what it embeds as: a YouTube or Vimeo link becomes a
// privacy-friendly player address (youtube-nocookie, Vimeo's player), any other
// http(s) address a link card. Core, so both Website Pages (the embed block)
// and Presentations (a video slide) share one parser.
export function embedFor(
  url: string
): { kind: "video"; src: string } | { kind: "link"; href: string; host: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let yt = "";
  if (host === "youtu.be") yt = u.pathname.slice(1);
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    yt = u.searchParams.get("v") ?? (/^\/(?:embed|shorts|live)\/([\w-]+)/.exec(u.pathname)?.[1] ?? "");
  }
  if (/^[\w-]{6,20}$/.test(yt)) return { kind: "video", src: `https://www.youtube-nocookie.com/embed/${yt}` };
  const vimeo = host === "vimeo.com" || host === "player.vimeo.com" ? /(\d{5,})/.exec(u.pathname)?.[1] : undefined;
  if (vimeo) return { kind: "video", src: `https://player.vimeo.com/video/${vimeo}` };
  return { kind: "link", href: u.toString(), host };
}
