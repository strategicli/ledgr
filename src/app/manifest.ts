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
    // Share target (PRD §4.4): content shared to the installed app from
    // Android's share sheet lands at /capture/share. POST + multipart so the
    // app is offered for BOTH a shared URL/text (quick capture → inbox item)
    // AND a shared text *file* (a recording app's transcript .txt → an inbox
    // transcript, then a meeting picker). The route handler branches on what
    // arrived. iOS has no share-target support and stays on the in-app
    // paste/upload paths (§4.5). A manifest allows only one share_target, so
    // file + url/text share the single POST entry.
    share_target: {
      action: "/capture/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "transcript",
            accept: ["text/plain", "text/markdown", ".txt", ".text", ".md", ".markdown"],
          },
        ],
      },
    },
  };
}
