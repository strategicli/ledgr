// The phone remote page (/live/<token>/remote#<key>). It shows the follow page
// (exactly what the audience sees) in a frame, with Back / Black / Next laid
// over it and the slide list beside or below it. Taps go to the server; the
// presenter window picks them up and moves the show, so the phone never holds
// the show's state itself, it only reads it back like any viewer.
// Pure: no db imports. Same self-contained, no-assets posture as player-html.
import { escapeHtml } from "@/lib/print-html";
import { safeJson } from "@/modules/presentations/lib/player-html";

export type RemoteOptions = { title: string; version: string; slides: string[] };

const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:#0a0a0a;color:#f2f2f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  -webkit-tap-highlight-color:transparent;overscroll-behavior:none}
body{display:flex;flex-direction:column;height:100dvh;overflow:hidden}
.bar{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.5rem .9rem;font-size:14px;
  color:#aaa;border-bottom:1px solid #262626;flex:none}
.bar .live{color:#e5484d;font-weight:600}
.bar .pos{color:#f2f2f2;font-weight:600}
.bar .msg{color:#f5b942}
.view{position:relative;width:100%;aspect-ratio:16/9;background:#000;flex:none;user-select:none}
.view iframe{position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none}
.tap{position:absolute;top:0;bottom:0;border:0;background:transparent;padding:0}
.tap.back{left:0;width:33%}
.tap.next{right:0;width:67%}
.controls{position:absolute;left:0;right:0;bottom:0;display:flex;gap:.5rem;padding:.6rem;
  background:linear-gradient(transparent,rgba(0,0,0,.8))}
.controls button{flex:1;min-height:48px;border-radius:10px;border:1px solid rgba(255,255,255,.25);
  background:rgba(255,255,255,.14);color:#fff;font:600 16px system-ui,sans-serif;backdrop-filter:blur(4px)}
.controls button.next{flex:2;background:#2f6fed;border-color:#2f6fed}
.controls button.blk.on{background:#fff;color:#000}
.controls button:active{transform:scale(.97)}
.list{flex:1;min-height:0;overflow-y:auto;border-top:1px solid #262626}
.item{display:flex;gap:.75rem;align-items:center;padding:.8rem .9rem;border-bottom:1px solid #1d1d1d;font-size:15px}
.item .n{width:1.8em;text-align:right;color:#888;font-variant-numeric:tabular-nums;flex:none}
.item .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item.cur{background:rgba(47,111,237,.25)}
.item.cur .t{color:#fff;font-weight:600}
.notice{flex:1;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem;font-size:20px;color:#ccc}
@media (orientation:landscape){
  body{display:grid;grid-template-columns:1fr minmax(180px,32%);grid-template-rows:auto 1fr}
  .bar{grid-column:1 / -1}
  .view{aspect-ratio:auto;height:100%}
  .list{border-top:0;border-left:1px solid #262626}
}
`;

export function renderRemote(opts: RemoteOptions): string {
  const data = safeJson({ version: opts.version, slides: opts.slides });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>Remote: ${escapeHtml(opts.title || "Untitled")}</title>
<style>${CSS}</style>
</head>
<body>
<div class="bar"><span class="live">&#9679; Live</span><span class="pos" id="pos"></span><span class="msg" id="msg"></span><span id="clock">0:00</span></div>
<div class="view">
  <iframe id="frame" title="What the audience sees" allow="autoplay 'none'"></iframe>
  <button class="tap back" id="tap-back" aria-label="Back"></button>
  <button class="tap next" id="tap-next" aria-label="Next"></button>
  <div class="controls">
    <button id="back">&#9664; Back</button>
    <button class="blk" id="black">Black</button>
    <button class="next" id="next">Next &#9654;</button>
  </div>
</div>
<div class="list" id="list"></div>
<script type="application/json" id="deck">${data}</script>
<script>
(function(){
"use strict";
var DECK = JSON.parse(document.getElementById("deck").textContent);
var KEY = location.hash.slice(1);
var FOLLOW = location.pathname.replace(/\\/remote\\/?$/, "");
var state = null, shownI = -1, ended = false, started = null;
var queue = Promise.resolve();
function $(id) { return document.getElementById(id); }
function say(text) { var m = $("msg"); if (m) m.textContent = text; }

function stop(text) {
  ended = true;
  document.body.innerHTML = '<div class="notice"></div>';
  document.body.firstChild.textContent = text;
}
if (!KEY) { stop("This remote link is missing its key. Scan the code in the presenter window again."); return; }

// A slide's first line of text (its heading, usually). DOMParser, not
// innerHTML on a detached div: it reads the text without fetching every
// picture on the slides.
function titleOf(html) {
  var body = new DOMParser().parseFromString(html, "text/html").body;
  var t = "";
  for (var i = 0; i < body.children.length && !t; i++) t = (body.children[i].textContent || "").trim();
  t = (t || body.textContent || "").trim().replace(/\\s+/g, " ");
  return t.slice(0, 80) || "(picture)";
}
function renderList() {
  var list = $("list");
  list.innerHTML = "";
  DECK.slides.forEach(function (html, i) {
    var row = document.createElement("div");
    row.className = "item";
    row.dataset.i = String(i);
    row.innerHTML = '<span class="n"></span><span class="t"></span>';
    row.firstChild.textContent = String(i + 1);
    row.lastChild.textContent = titleOf(html);
    list.appendChild(row);
  });
  shownI = -1;
  paint();
}
function paint() {
  if (!state) return;
  $("pos").textContent = (state.i + 1) + " of " + DECK.slides.length;
  $("black").classList.toggle("on", state.blank === "black");
  if (state.i === shownI) return;
  shownI = state.i;
  Array.prototype.forEach.call($("list").children, function (row, i) { row.classList.toggle("cur", i === state.i); });
  var cur = $("list").children[state.i];
  if (cur) cur.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Taps go one at a time, in order, so a quick double tap moves twice.
function send(cmd) {
  if (ended) return;
  if (navigator.vibrate) navigator.vibrate(15);
  if (started === null) started = Date.now();
  queue = queue.then(function () {
    return fetch(location.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: KEY, cmd: cmd }),
    }).then(function (r) {
      if (r.status === 404) stop("This presentation has ended.");
      else if (r.status === 403) stop("This remote link no longer works. Scan the code in the presenter window again.");
      else say(r.ok ? "" : "Not sent");
    }, function () { say("No connection"); });
  });
}
$("next").onclick = $("tap-next").onclick = function () { send({ a: "next" }); };
$("back").onclick = $("tap-back").onclick = function () { send({ a: "prev" }); };
$("black").onclick = function () { send({ a: "black" }); };
$("list").onclick = function (e) {
  var row = e.target.closest(".item");
  if (row) send({ a: "goto", i: parseInt(row.dataset.i, 10) });
};

// Read the show back the same way the follow page does.
function poll() {
  if (ended) return;
  fetch(FOLLOW + "?format=state", { cache: "no-store" })
    .then(function (r) {
      if (r.status === 404) { stop("This presentation has ended."); return null; }
      return r.json();
    })
    .then(function (data) {
      if (!data) return;
      if ($("msg").textContent === "No connection") say("");
      state = data.state;
      if (data.version && data.version !== DECK.version) {
        return fetch(location.pathname + "?format=json", { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (d) { DECK = d; renderList(); });
      }
      paint();
    })
    .catch(function () { say("No connection"); });
}
setInterval(poll, 700);
poll();

setInterval(function () {
  if (started === null || ended) return;
  var s = Math.floor((Date.now() - started) / 1000), m = Math.floor(s / 60), r = s % 60;
  $("clock").textContent = m + ":" + (r < 10 ? "0" : "") + r;
}, 1000);

// Keep the phone's screen on while the remote is open. The lock drops when
// the page is hidden, so take it again on return.
function keepAwake() {
  if (navigator.wakeLock && document.visibilityState === "visible") navigator.wakeLock.request("screen").catch(function () {});
}
document.addEventListener("visibilitychange", keepAwake);
keepAwake();

$("frame").src = FOLLOW;
renderList();
})();
</script>
</body>
</html>`;
}
