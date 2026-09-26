// The presentations player page (explorations/presentations.md step 2): one
// self-contained HTML document — inline CSS/JS, no external assets — so the
// exact same bytes work served by the owner route and downloaded for offline
// use (step 4 wires the download). Pure: no db imports, safe for both.
//
// Two windows, one state shape ({i, step, blank, countdownEnd}), synced with
// postMessage (works from a file:// download; BroadcastChannel does not).
// `applyState` is the single seam "follow" mode (step 6) drives from a polled
// public state endpoint instead of postMessage.
//
// "follow" is the public /live/<token> render: always the audience role, no
// keyboard nav or click-to-advance (F for fullscreen still works), state comes
// from polling instead of postMessage. "owner" adds the "Go live" controls
// that mint/end that link and push state to it after every change.
import { escapeHtml } from "@/lib/print-html";

export type PlayerSlide = { html: string; notesHtml: string };
export type PlayerOptions = {
  title: string;
  version: string;
  slides: PlayerSlide[];
  mode: "owner" | "offline" | "follow";
  downloadUrl?: string;
};

// `<` -> < so `</script` can never close the embedding tag early; U+2028/9
// are valid JSON but illegal unescaped in JS string literals in older engines.
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CSS = `
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:#000;color:#f2f2f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
button,input{font:inherit}
html:not([data-role="audience"]) #audience{display:none}
html[data-role="audience"] #presenter{display:none}

.stage-wrap{position:relative;width:100%;height:100%;background:#000;overflow:hidden}
.stage{position:absolute;top:50%;left:50%;width:1600px;height:900px;background:#000;color:#f5f5f5;transform-origin:center center}
.stage-inner{position:absolute;inset:0;padding:80px;overflow:hidden;display:flex;flex-direction:column;justify-content:center;line-height:1.3}
.stage.layout-image .stage-inner{padding:0;align-items:center;justify-content:center}
.stage.layout-image img{max-width:100%;max-height:100%;object-fit:contain;margin:auto;display:block}
.stage.layout-quote .stage-inner{align-items:center;text-align:center;font-style:italic}
.stage.layout-big .stage-inner{align-items:center;text-align:center;font-weight:700}
.stage.layout-text .stage-inner{align-items:flex-start;text-align:left}
.stage.layout-text h1,.stage.layout-text h2,.stage.layout-text h3{font-weight:700;margin:0 0 .3em}
.stage-inner ul,.stage-inner ol{padding-left:1.1em;margin:0}
.stage-inner li{margin:.15em 0}

#audience{position:fixed;inset:0}
.blank-overlay{position:fixed;inset:0;background:#000;display:none;align-items:center;justify-content:center;
  color:#f2f2f2;font-size:5vw;font-weight:700;text-align:center}
.countdown-overlay{position:fixed;inset:0;background:#000;display:none;align-items:center;justify-content:center}
.countdown-num{font-size:12vw;font-variant-numeric:tabular-nums;color:#f2f2f2}

#presenter{position:fixed;inset:0;display:flex;flex-direction:column}
.bar{display:flex;align-items:center;justify-content:space-between;padding:.6rem 1rem;
  background:#111;border-bottom:1px solid #262626;font-size:14px}
.bar-mid{display:flex;align-items:center;gap:.6rem}
.bar button{background:#262626;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.3rem .7rem;cursor:pointer}
.main{flex:1;display:grid;grid-template-columns:1fr 360px;min-height:0}
.left{display:flex;flex-direction:column;min-height:0}
.left .stage-wrap{flex:1;min-height:0}
.notes{height:22%;min-height:120px;overflow-y:auto;background:#0d0d0d;border-top:1px solid #262626;
  padding:1rem 1.25rem;font-size:20px;line-height:1.5;color:#e5e5e5}
.right{display:flex;flex-direction:column;border-left:1px solid #262626;background:#0a0a0a;overflow-y:auto}
.next-label{padding:.5rem 1rem 0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#888}
.right .stage-wrap{height:150px;flex:none;margin:.4rem 1rem}
.right .stage{border:1px solid #262626}
.controls{padding:.75rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-top:1px solid #262626;border-bottom:1px solid #262626}
.controls button,.controls a{background:#262626;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;
  padding:.45rem .7rem;cursor:pointer;text-align:center;text-decoration:none;display:block}
.controls label{display:flex;align-items:center;gap:.4rem;font-size:14px}
.countdown-row{display:flex;gap:.4rem}
.countdown-row input{width:70px;background:#1a1a1a;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.4rem}
.live-link-row{display:flex;gap:.4rem}
.live-link-row input{flex:1;min-width:0;background:#1a1a1a;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.4rem}
.live-note{font-size:12px;color:#999}
.slide-list{padding:.5rem 1rem 1rem;font-size:13px;color:#ccc}
.slide-list-item{padding:.35rem .4rem;border-radius:5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slide-list-item:hover{background:#1a1a1a}
.slide-list-item.active{background:#26365e;color:#fff}
`;

export function renderPlayer(opts: PlayerOptions): string {
  const deckData = safeJson({
    title: opts.title,
    version: opts.version,
    slides: opts.slides,
  });
  const modeJson = safeJson(opts.mode);
  const downloadJson = safeJson(opts.downloadUrl ?? null);
  const safeTitle = escapeHtml(opts.title || "Untitled");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${CSS}</style>
</head>
<body>
<script>document.documentElement.dataset.role = ${opts.mode === "follow" ? '"audience"' : 'location.hash.slice(1) === "audience" ? "audience" : "presenter"'};</script>
<script type="application/json" id="deck">${deckData}</script>
<div id="audience">
  <div class="stage-wrap" id="a-wrap"><div class="stage" id="a-stage"><div class="stage-inner"></div></div></div>
  <div class="blank-overlay" id="a-blank"></div>
  <div class="countdown-overlay" id="a-countdown"><div class="countdown-num"></div></div>
</div>
<div id="presenter">
  <div class="bar">
    <span id="p-count"></span>
    <div class="bar-mid">
      <button id="p-timer-toggle">Pause</button>
      <span id="p-elapsed">0:00</span>
      <button id="p-timer-reset">Reset</button>
    </div>
    <span id="p-clock"></span>
  </div>
  <div class="main">
    <div class="left">
      <div class="stage-wrap" id="p-wrap"><div class="stage" id="p-stage"><div class="stage-inner"></div></div></div>
      <div class="notes" id="p-notes"></div>
    </div>
    <div class="right">
      <div class="next-label">Next</div>
      <div class="stage-wrap" id="n-wrap"><div class="stage" id="n-stage"><div class="stage-inner"></div></div></div>
      <div class="controls">
        <button id="open-audience">Open audience window</button>
        <button id="present-here">Present here</button>
        <label><input type="checkbox" id="build-lists"> Build lists</label>
        <div class="countdown-row">
          <input type="number" id="countdown-min" min="1" placeholder="Minutes">
          <button id="start-countdown">Start countdown</button>
        </div>
        <div class="live-row" id="live-idle" style="display:none"><button id="go-live">Go live</button></div>
        <div class="live-panel" id="live-panel" style="display:none">
          <div class="live-link-row"><input type="text" id="live-link" readonly><button id="live-copy">Copy</button></div>
          <div class="live-note">Anyone who can reach this address can follow along.</div>
          <button id="end-live">End live</button>
        </div>
        <a id="save-offline" style="display:none">Save offline</a>
      </div>
      <div class="slide-list" id="slide-list"></div>
    </div>
  </div>
</div>
<script>
(function(){
"use strict";
var DECK = JSON.parse(document.getElementById("deck").textContent);
var MODE = ${modeJson}; // "owner" | "offline" — the seam for a later "follow" mode
var DOWNLOAD_URL = ${downloadJson};

var role = document.documentElement.dataset.role === "audience" ? "audience" : "presenter";
var state = { i: 0, step: 0, blank: "", countdownEnd: null, build: false };
var audienceWin = null;
var KNOWN_PEER = null;
var liveToken = null; // owner mode only: the token of the "Go live" link, if any
var liveEnded = false; // follow mode only: stops polling once the link 404s

// Build lists rides the synced state so the audience window reveals the same steps.
try { state.build = localStorage.getItem("ledgr-present-build-lists") === "1"; } catch (e) {}

function $(sel) { return document.getElementById(sel); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function slideCount() { return DECK.slides.length; }
function escapeHtmlJs(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function firstLine(html) {
  var d = document.createElement("div"); d.innerHTML = html;
  var t = (d.textContent || "").trim().replace(/\\s+/g, " ");
  return t.slice(0, 60) || "(empty)";
}
function send(win, data) { if (win) { try { win.postMessage(data, "*"); } catch (e) {} } }

// ---- layout + fit-to-box: the one renderer audience and presenter share ----
function detectLayout(el) {
  var imgs = el.querySelectorAll("img");
  var text = (el.textContent || "").trim();
  if (imgs.length === 1 && text.length === 0) return "image";
  var kids = el.children;
  if (kids.length === 1 && kids[0].tagName === "BLOCKQUOTE") return "quote";
  if (kids.length === 1 && text.length > 0 && text.length < 80) return "big";
  return "text";
}
function fitText(el, startSize, minSize) {
  var size = startSize;
  el.style.fontSize = size + "px";
  var guard = 0;
  while (guard++ < 60 && size > minSize && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
    size = size * 0.95;
    el.style.fontSize = size + "px";
  }
}
function listItems(el) {
  return Array.prototype.slice.call(el.querySelectorAll(":scope > ul > li, :scope > ol > li"));
}
function mountStage(stageEl, html, step) {
  var inner = stageEl.querySelector(".stage-inner");
  inner.innerHTML = html || "";
  stageEl.className = "stage";
  var layout = detectLayout(inner);
  stageEl.classList.add("layout-" + layout);
  var lis = listItems(inner);
  if (lis.length && typeof step === "number") {
    lis.forEach(function (li, idx) { li.style.display = idx <= step ? "" : "none"; });
  }
  if (layout !== "image") {
    var startSize = layout === "big" ? 120 : layout === "quote" ? 72 : 56;
    fitText(inner, startSize, 14);
  }
  return lis.length;
}
function scaleStage(wrap, stage) {
  var scale = Math.min(wrap.clientWidth / 1600, wrap.clientHeight / 900);
  stage.style.transform = "translate(-50%,-50%) scale(" + scale + ")";
}
function currentListCount() {
  if (!state.build) return 0;
  var s = DECK.slides[state.i];
  if (!s) return 0;
  var d = document.createElement("div"); d.innerHTML = s.html;
  return listItems(d).length;
}

// ---- the render seam: everything on screen comes from state + DECK ----
function render() {
  if (role === "audience") renderAudience(); else renderPresenter();
}
function applyState(newState) {
  state = newState;
  render();
}

function renderAudience() {
  var wrap = $("a-wrap"), stage = $("a-stage"), blank = $("a-blank"), cd = $("a-countdown");
  if (state.blank === "black") {
    blank.style.display = "flex"; blank.textContent = ""; stage.style.visibility = "hidden";
  } else if (state.blank === "title") {
    blank.style.display = "flex"; blank.textContent = DECK.title; stage.style.visibility = "hidden";
  } else {
    blank.style.display = "none"; stage.style.visibility = "visible";
  }
  cd.style.display = state.countdownEnd ? "flex" : "none";
  if (state.countdownEnd) updateCountdown();
  var slide = DECK.slides[state.i];
  if (slide) mountStage(stage, slide.html, state.build ? state.step : null);
  scaleStage(wrap, stage);
}

function renderPresenter() {
  $("p-count").textContent = "Slide " + (state.i + 1) + " / " + slideCount();
  var cur = DECK.slides[state.i], next = DECK.slides[state.i + 1];
  mountStage($("p-stage"), cur ? cur.html : "", state.build ? state.step : null);
  scaleStage($("p-wrap"), $("p-stage"));
  mountStage($("n-stage"), next ? next.html : '<p style="opacity:.4">End</p>', null);
  scaleStage($("n-wrap"), $("n-stage"));
  $("p-notes").innerHTML = cur ? cur.notesHtml : "";
  renderSlideList();
}
function renderSlideList() {
  $("slide-list").innerHTML = DECK.slides
    .map(function (s, idx) {
      return '<div class="slide-list-item' + (idx === state.i ? " active" : "") + '" data-i="' + idx + '">' +
        (idx + 1) + ". " + escapeHtmlJs(firstLine(s.html)) + "</div>";
    })
    .join("");
}

// ---- navigation ----
var startTime = null, timerRunning = false, elapsedMs = 0;
function startTimerIfNeeded() {
  if (startTime === null) { startTime = Date.now(); timerRunning = true; }
}
function postLiveState() {
  if (!liveToken) return;
  fetch(location.pathname + "/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "state", token: liveToken, state: state, version: DECK.version }),
  }).catch(function () {});
}
function broadcastAndRender() { render(); send(KNOWN_PEER, { t: "state", state: state }); postLiveState(); }
function next() {
  var n = currentListCount();
  if (state.build && state.step < n - 1) {
    state.step++;
  } else {
    state.i = clamp(state.i + 1, 0, slideCount() - 1);
    state.step = 0;
    state.countdownEnd = null;
    startTimerIfNeeded();
  }
  broadcastAndRender();
}
function prev() {
  if (state.build && state.step > 0) {
    state.step--;
  } else if (state.i > 0) {
    state.i--;
    var cnt = currentListCount();
    state.step = state.build && cnt ? cnt - 1 : 0;
  }
  broadcastAndRender();
}
function goto(i) { state.i = clamp(i, 0, slideCount() - 1); state.step = 0; broadcastAndRender(); }
function toggleBlank(v) { state.blank = state.blank === v ? "" : v; broadcastAndRender(); }
function clearBlank() { state.blank = ""; broadcastAndRender(); }
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(function () {});
}

// ---- keys (ignored while typing in a field; clickers send PageUp/Down, b/.) ----
var pendingDigits = "", digitTimer = null;
function jumpFromDigits() {
  var n = parseInt(pendingDigits, 10);
  pendingDigits = "";
  if (!isNaN(n)) goto(n - 1);
}
document.addEventListener("keydown", function (e) {
  var tag = (e.target && e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  var k = e.key;
  if (MODE === "follow" && k !== "f") return; // follow mode: no navigation, only fullscreen
  if (k === "ArrowRight" || k === "ArrowDown" || k === " " || k === "PageDown" || k === "n") {
    e.preventDefault(); next();
  } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "p") {
    e.preventDefault(); prev();
  } else if (k === "Home") { goto(0); }
  else if (k === "End") { goto(slideCount() - 1); }
  else if (k >= "0" && k <= "9") {
    pendingDigits += k;
    clearTimeout(digitTimer);
    digitTimer = setTimeout(function () { pendingDigits = ""; }, 2000);
  } else if (k === "Enter") {
    if (pendingDigits) jumpFromDigits(); else next();
  } else if (k === "b" || k === ".") { toggleBlank("black"); }
  else if (k === "w") { toggleBlank("title"); }
  else if (k === "Escape") { clearBlank(); }
  else if (k === "f") { toggleFullscreen(); }
});

// ---- postMessage sync (not BroadcastChannel: must work from file://) -----
window.addEventListener("message", function (e) {
  if (KNOWN_PEER && e.source !== KNOWN_PEER) return;
  var data = e.data || {};
  if (data.t === "hello") {
    KNOWN_PEER = e.source;
    send(KNOWN_PEER, { t: "deck", deck: DECK });
    send(KNOWN_PEER, { t: "state", state: state });
  } else if (data.t === "state") {
    applyState(data.state);
  } else if (data.t === "deck") {
    DECK = data.deck;
    render();
  }
});

// ---- audience-only behavior: click to advance, cursor hides when idle -----
var cursorTimer = null;
function resetCursor() {
  document.body.style.cursor = "";
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(function () { document.body.style.cursor = "none"; }, 2000);
}
function initAudience() {
  if (MODE !== "follow") document.addEventListener("click", function () { next(); });
  document.addEventListener("mousemove", resetCursor);
  resetCursor();
  if (window.opener) { KNOWN_PEER = window.opener; send(KNOWN_PEER, { t: "hello" }); }
  render();
  if (MODE === "follow") initFollowPolling();
}

// ---- follow mode: a public viewer has no postMessage peer, so it polls the
// public state endpoint instead. One DB read per viewer per second, fine for
// a small room; a hub with hundreds of concurrent viewers would want a push
// channel instead.
function showEnded() {
  document.body.innerHTML =
    '<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'color:#f2f2f2;font-size:24px;text-align:center;padding:2rem">This presentation has ended.</div>';
}
function initFollowPolling() {
  setInterval(function () {
    if (liveEnded) return;
    fetch(location.pathname + "?format=state", { cache: "no-store" })
      .then(function (r) {
        if (r.status === 404) { liveEnded = true; showEnded(); return null; }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        if (data.version !== DECK.version) {
          return fetch(location.pathname + "?format=json", { cache: "no-store" })
            .then(function (r2) { return r2.json(); })
            .then(function (deck2) { DECK = deck2; applyState(data.state); });
        }
        applyState(data.state);
      })
      .catch(function () {});
  }, 1000);
}

// ---- countdown ----
var countdownTick = null;
function updateCountdown() {
  clearInterval(countdownTick);
  countdownTick = setInterval(function () {
    if (!state.countdownEnd) { clearInterval(countdownTick); return; }
    var remaining = Math.max(0, Math.round((state.countdownEnd - Date.now()) / 1000));
    var m = Math.floor(remaining / 60), s = remaining % 60;
    var el = document.querySelector("#a-countdown .countdown-num");
    if (el) el.textContent = m + ":" + (s < 10 ? "0" : "") + s;
  }, 250);
}

// ---- presenter-only wiring ----
function fmtMMSS(s) { var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }
function initPresenter() {
  setInterval(function () {
    if (!timerRunning) return;
    $("p-elapsed").textContent = fmtMMSS(Math.floor((elapsedMs + (Date.now() - startTime)) / 1000));
  }, 500);
  $("p-timer-toggle").addEventListener("click", function () {
    if (timerRunning) {
      elapsedMs += Date.now() - startTime; timerRunning = false; this.textContent = "Resume";
    } else {
      startTime = Date.now(); timerRunning = true; this.textContent = "Pause";
    }
  });
  $("p-timer-reset").addEventListener("click", function () {
    elapsedMs = 0; startTime = timerRunning ? Date.now() : null; $("p-elapsed").textContent = "0:00";
  });
  function tickClock() {
    var d = new Date(), h = d.getHours() % 12 || 12, m = d.getMinutes();
    $("p-clock").textContent = h + ":" + (m < 10 ? "0" : "") + m;
  }
  setInterval(tickClock, 15000); tickClock();

  $("open-audience").addEventListener("click", function () {
    audienceWin = window.open(location.pathname + location.search + "#audience", "ledgr-audience");
    KNOWN_PEER = audienceWin;
  });
  $("present-here").addEventListener("click", function () {
    document.documentElement.dataset.role = "audience";
    history.replaceState(null, "", location.pathname + location.search + "#audience");
    role = "audience";
    initAudience();
    document.documentElement.requestFullscreen().catch(function () {});
  });
  var cb = $("build-lists");
  cb.checked = state.build;
  cb.addEventListener("change", function () {
    state.build = cb.checked;
    try { localStorage.setItem("ledgr-present-build-lists", state.build ? "1" : "0"); } catch (e) {}
    state.step = 0;
    broadcastAndRender();
  });
  $("start-countdown").addEventListener("click", function () {
    var mins = parseFloat($("countdown-min").value);
    if (!mins || mins <= 0) return;
    state.countdownEnd = Date.now() + mins * 60000;
    broadcastAndRender();
  });
  $("slide-list").addEventListener("click", function (e) {
    var t = e.target.closest(".slide-list-item");
    if (t) goto(parseInt(t.dataset.i, 10));
  });
  if (DOWNLOAD_URL) {
    var a = $("save-offline");
    a.href = DOWNLOAD_URL;
    a.style.display = "block";
  }
  // Go live: mints/ends the public /live/<token> link. Never on a file://
  // download (there's no server behind it) and never in offline mode.
  if (MODE === "owner" && location.protocol !== "file:") {
    $("live-idle").style.display = "block";
    $("go-live").addEventListener("click", function () {
      fetch(location.pathname + "/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          liveToken = data.token;
          $("live-link").value = location.origin + data.url;
          $("live-idle").style.display = "none";
          $("live-panel").style.display = "block";
          postLiveState();
        })
        .catch(function () {});
    });
    $("live-copy").addEventListener("click", function () {
      var input = $("live-link");
      input.select();
      try { document.execCommand("copy"); } catch (e) {}
    });
    $("end-live").addEventListener("click", function () {
      if (!liveToken) return;
      var token = liveToken;
      liveToken = null;
      fetch(location.pathname + "/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", token: token }),
      }).catch(function () {});
      $("live-panel").style.display = "none";
      $("live-idle").style.display = "block";
    });
  }
  render();
}

if (role === "presenter") initPresenter(); else initAudience();
// Re-fit on resize: entering full screen, dragging to the projector, and a first
// render that ran before layout settled all change the box the stage scales into.
window.addEventListener("resize", render);
requestAnimationFrame(render);

// ---- live edits: owner mode only, and never from a file:// download ----
if (MODE === "owner" && location.protocol !== "file:") {
  setInterval(function () {
    if (document.visibilityState !== "visible") return;
    fetch(location.pathname + "?format=json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.version && data.version !== DECK.version) {
          DECK = data;
          state.i = clamp(state.i, 0, slideCount() - 1);
          render();
          send(KNOWN_PEER, { t: "deck", deck: DECK });
          postLiveState();
        }
      })
      .catch(function () {});
  }, 5000);
}
})();
</script>
</body>
</html>`;
}
