// Verifies the mail viewer's cleaning (src/modules/mail/lib/safe-html.ts):
// hostile HTML loses its scripts, handlers, forms and frames; remote images are
// held back until asked; the page's CSP allows no script and no network.
// Pure: DOMPurify runs on jsdom (a dev-only dependency; linkedom is not a DOM
// DOMPurify supports). Run: npx tsx scripts/verify-mail-safe-html.mts
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { buildMailDocument, mailCsp } from "../src/modules/mail/lib/safe-html";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const purify = createDOMPurify(new JSDOM("").window as unknown as Parameters<typeof createDOMPurify>[0]);
check("DOMPurify runs on jsdom", purify.isSupported === true);

// Fail closed: where DOMPurify can't run (e.g. server render), nothing shows.
const unsupported = createDOMPurify({} as Parameters<typeof createDOMPurify>[0]);
const closed = buildMailDocument(unsupported, { html: "<p>secret</p><script>x</script>", text: null }, { allowRemoteImages: false });
check("no DOM: shows nothing rather than raw HTML", !closed.srcDoc.includes("secret") && !closed.srcDoc.includes("<script>"));

const hostile = `
  <p onclick="steal()">Hello <b>there</b></p>
  <script>steal()</script>
  <img src="https://tracker.example/pixel.gif" onerror="steal()">
  <img src="cid:logo123">
  <a href="javascript:steal()">bad link</a>
  <a href="https://example.org">good link</a>
  <form action="https://evil.example"><input name="pw"></form>
  <iframe src="https://evil.example"></iframe>
  <svg><script>steal()</script></svg>
  <style>p{color:red}</style>
  <meta http-equiv="refresh" content="0;url=https://evil.example">`;

const blocked = buildMailDocument(purify, { html: hostile, text: null }, { allowRemoteImages: false });
const body = blocked.srcDoc.slice(blocked.srcDoc.indexOf("<body>"));
check("script tags removed", !/<script/i.test(body));
check("event handlers removed", !/onclick|onerror/i.test(body));
check("javascript: links removed", !/javascript:/i.test(body));
check("forms and inputs removed", !/<form|<input/i.test(body));
check("iframes removed", !/<iframe/i.test(body));
check("meta refresh removed from the body", !/http-equiv="refresh"/i.test(body));
check("ordinary formatting kept", /<b>there<\/b>/.test(body));
check("links open in a new tab without referrer", /href="https:\/\/example.org"[^>]*target="_blank"|target="_blank"[^>]*href="https:\/\/example.org"/.test(body) && /noopener noreferrer/.test(body));
check(
  "remote image held back",
  blocked.blockedImages === 1 && !/\ssrc="https:\/\/tracker/.test(body) && /data-blocked-src/.test(body),
  body.match(/<img[^>]*>/g)?.join(" ") + ` blocked=${blocked.blockedImages}`
);
check("inline cid image kept", /src="cid:logo123"/.test(body));

const shown = buildMailDocument(purify, { html: hostile, text: null }, { allowRemoteImages: true });
check("remote image shown when asked", shown.blockedImages === 0 && /src="https:\/\/tracker.example\/pixel.gif"/.test(shown.srcDoc));
check("hooks don't pile up between calls", buildMailDocument(purify, { html: "<p>x</p>", text: null }, { allowRemoteImages: false }).blockedImages === 0);

const csp = mailCsp(false);
check("CSP blocks all scripts and network by default", csp.startsWith("default-src 'none'") && !/script-src/.test(csp) && !/https:/.test(csp));
check("CSP lets remote images through only when asked", /img-src data: cid: https: http:/.test(mailCsp(true)));
check("CSP sits in the document head", blocked.srcDoc.includes(`content="${csp}"`));

const plain = buildMailDocument(purify, { html: null, text: "a < b & <script>x</script>" }, { allowRemoteImages: false });
check("plain text is escaped", plain.srcDoc.includes("a &#60; b &#38; &#60;script&#62;") && !plain.srcDoc.includes("<script>"));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall mail safe-html checks passed");
