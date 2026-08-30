// Verifies the tokenless web clipper (ADR-238): the bookmarklet carries no
// credential, saves through a same-origin relay popup, and survives the
// sign-in round trip. Pure, no DB/network.
//   npx tsx scripts/verify-clipper-tokenless.mts
import { readFileSync } from "node:fs";
import { buildBookmarklet } from "../src/components/build/ClipperSetup";

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

const ORIGIN = "https://ledgr.example.com";
const src = decodeURIComponent(buildBookmarklet(ORIGIN).replace(/^javascript:/, ""));

check("is a javascript: URL", buildBookmarklet(ORIGIN).startsWith("javascript:"));
check("opens the relay on Ledgr's own origin", src.includes(`${ORIGIN}/capture/relay`));
check("sends the page URL, title, and DOM", /url:location\.href/.test(src) && /title:document\.title/.test(src) && /outerHTML/.test(src));
check("posts to the relay's exact origin, never '*'", src.includes(`,"${ORIGIN}")`) && !src.includes('postMessage(d,"*")'));

// The whole point: nothing secret rides in the bookmark, so the same URL works
// for anyone and there is nothing to revoke.
check("carries no token field", !/token/i.test(src));
check("carries no bearer header", !/Bearer|Authorization/i.test(src));

// The popup may land on /sign-in first and announce itself only on a SECOND
// page load. A one-shot listener would be gone by then, so it must not remove
// itself — this is what makes "click it, sign in, it saves" work.
check(
  "answers every ready ping (listener is not one-shot)",
  src.includes("ledgr-relay-ready") && !src.includes("removeEventListener")
);
check("warns when the popup is blocked", /allow pop-ups/i.test(src));

// Structural tripwires: the two files the credential-free path depends on.
const relay = readFileSync("src/app/capture/relay/page.tsx", "utf8");
// Matches the header as CODE (a backticked Bearer value), so the comment
// explaining its absence doesn't trip the check.
check("relay sends no Authorization header", !/Authorization:\s*`/.test(relay));
check("relay posts to the capture route", relay.includes("/api/machine/capture"));
check("relay tells a signed-out clipper what to do", /sign in to Ledgr/.test(relay));

const route = readFileSync("src/app/api/machine/capture/route.ts", "utf8");
check("capture route falls back to the session owner", /resolveOwner\(\)/.test(route));
check("capture route still accepts a machine token first", /verifyApiRequest/.test(route));
check(
  "capture route never sets Allow-Credentials (open CORS must stay cookie-free)",
  !/"Access-Control-Allow-Credentials"/.test(route)
);

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail > 0 ? 1 : 0;
