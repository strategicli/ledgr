// Offline download filename (step 4). Pure: no db import, so the verify
// script can exercise it directly. `ext` lets the export routes (ProPresenter
// .txt, PowerPoint .pptx) reuse the same sanitizing without dragging ".html"
// along; existing callers that omit it keep the original behavior.
export function safeDownloadFilename(title: string, ext = "html"): { ascii: string; utf8: string } {
  // Characters invalid in a Windows filename, plus control chars.
  const cleaned = (title || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
  const base = cleaned || "presentation";
  const ascii = base.replace(/[^\x20-\x7e]/g, "_") + "." + ext;
  const utf8 = encodeURIComponent(base + "." + ext);
  return { ascii, utf8 };
}
