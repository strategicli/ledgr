// Pure verify for the offline-download helpers (no DB): the attachment-id
// scanner and the filename sanitizer. Run with `npx tsx`.
import assert from "node:assert";
import { findAttachmentIds } from "../src/modules/presentations/lib/attachment-ids";
import { safeDownloadFilename } from "../src/modules/presentations/lib/filename";

// findAttachmentIds
assert.deepStrictEqual(
  findAttachmentIds('<img src="/files/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">'),
  ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]
);
assert.deepStrictEqual(
  findAttachmentIds(
    '<img src="/files/AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee"><img src="/files/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">'
  ),
  ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
  "same id different case dedupes"
);
assert.deepStrictEqual(findAttachmentIds("<p>no images here</p>"), []);

// safeDownloadFilename
assert.deepStrictEqual(safeDownloadFilename("Sunday Sermon"), {
  ascii: "Sunday Sermon.html",
  utf8: "Sunday%20Sermon.html",
});
assert.strictEqual(safeDownloadFilename("").ascii, "presentation.html");
assert.strictEqual(safeDownloadFilename('a/b:c*d?e"f<g>h|i').ascii, "a_b_c_d_e_f_g_h_i.html");
assert.strictEqual(safeDownloadFilename("Café Talk").ascii, "Caf_ Talk.html");
assert.strictEqual(safeDownloadFilename("Café Talk").utf8, encodeURIComponent("Café Talk.html"));

console.log("verify-presentation-inline: ok");
