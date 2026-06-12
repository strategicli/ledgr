import type { MetadataRoute } from "next";

// PWA manifest (slice 16, PRD §4.5). Served at /manifest.webmanifest; the
// middleware matcher already excludes *.webmanifest so installs work signed
// out. The 512 icon is full-bleed with the glyph inside the maskable safe
// zone, so one file serves both purposes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledgr",
    short_name: "Ledgr",
    description: "Personal life management: meetings, tasks, notes, and links.",
    start_url: "/",
    display: "standalone",
    background_color: "#191919",
    theme_color: "#191919",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Share target (PRD §4.4): a URL or text shared to the installed app
    // completes quick capture — /capture/share creates the inbox item.
    // GET, so the share is just a navigation (Android; iOS has no share
    // target support and stays on Todoist capture per §4.5).
    share_target: {
      action: "/capture/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
