// Offline download filename (step 4). Pure: no db import, so the verify
// script can exercise it directly.
export function safeDownloadFilename(title: string): { ascii: string; utf8: string } {
  // Characters invalid in a Windows filename, plus control chars.
  const cleaned = (title || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const base = cleaned || "presentation";
  const ascii = base.replace(/[^\x20-\x7e]/g, "_") + ".html";
  const utf8 = encodeURIComponent(base + ".html");
  return { ascii, utf8 };
}
