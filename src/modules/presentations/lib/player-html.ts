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
// that mint/end that link and push state to it after every change, plus the
// Design panel and Export group (design step, this file's second half).
//
// design.ts is the contract for a deck's look; this file can't import it at
// runtime in the page's own <script> (that script has no module system), so
// the constants it needs (theme colors, size tables) travel as an embedded
// JSON blob (META) and the option lists render server-side into <select>s.
import { escapeHtml } from "@/lib/print-html";
import {
  CORNERS,
  EFFECTS,
  SIZES,
  SPEEDS,
  THEMES,
  THEME_COLORS,
  MARGIN_PX,
  LOGO_PX,
  TITLE_PX,
  SPEED_MS,
  type DesignTheme,
  type Effect,
  type PresentationDesign,
} from "@/modules/presentations/lib/design";

export type PlayerSlide = { html: string; notesHtml: string };
export type PlayerOptions = {
  title: string;
  version: string;
  slides: PlayerSlide[];
  design: PresentationDesign;
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

const THEME_LABELS: Record<DesignTheme, string> = { dark: "Dark", light: "Light", gray: "Gray", sepia: "Sepia" };
const SIZE_LABELS: Record<(typeof SIZES)[number], string> = { s: "S", m: "M", l: "L" };
const CORNER_LABELS: Record<(typeof CORNERS)[number], string> = {
  tl: "Top left",
  tr: "Top right",
  bl: "Bottom left",
  br: "Bottom right",
};
const EFFECT_LABELS: Record<Effect, string> = {
  none: "None",
  fade: "Fade",
  // Key kept for saved designs; it now dips the content only, never the background.
  "fade-black": "Fade out, then in",
  "fade-up": "Fade up",
  "fade-down": "Fade down",
  "wipe-up": "Wipe up",
  "wipe-down": "Wipe down",
  grow: "Grow",
};
const SPEED_LABELS: Record<(typeof SPEEDS)[number], string> = { fast: "Fast", normal: "Normal", slow: "Slow" };

function optionTags(values: readonly string[], labels: Record<string, string>): string {
  return values.map((v) => `<option value="${v}">${labels[v]}</option>`).join("");
}
const THEME_OPTS = optionTags(THEMES, THEME_LABELS);
const SIZE_OPTS = optionTags(SIZES, SIZE_LABELS);
const CORNER_OPTS = optionTags(CORNERS, CORNER_LABELS);
const EFFECT_OPTS = optionTags(EFFECTS, EFFECT_LABELS);
const SPEED_OPTS = optionTags(SPEEDS, SPEED_LABELS);

// Every stage (audience layers, presenter current/next, print pages, image
// export) shares this skeleton: background image, darken overlay, the real
// content, logo and title bar — in DOM order, so later layers sit on top
// without needing z-index.
const STAGE_INNER =
  '<div class="stage-bg"></div><div class="stage-overlay"></div><div class="stage-inner"></div>' +
  '<div class="stage-logo"><img alt=""></div><div class="stage-titlebar"></div>';

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
.stage-inner li.build-hidden{visibility:hidden}
.stage-inner table{border-collapse:collapse;font-size:.8em;margin:.2em 0}
.stage-inner th,.stage-inner td{text-align:left;vertical-align:top;padding:.3em 1.2em .3em 0;border-bottom:2px solid rgba(128,128,128,.35)}
.stage-inner th{border-bottom:4px solid rgba(128,128,128,.75)}
.stage-inner tr:last-child td{border-bottom:none}
.stage-inner h1,.stage-inner h2,.stage-inner h3,.stage-inner h4{color:var(--heading-color,inherit)}
.stage-bg{position:absolute;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat;display:none}
.stage-overlay{position:absolute;inset:0;background:#000;display:none}
.stage-logo{position:absolute;display:none}
.stage-logo img{display:block;object-fit:contain}
.stage-titlebar{position:absolute;display:none;align-items:center;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

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
.right button{background:#262626;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.35rem .6rem;
  font-size:13px;cursor:pointer}
.right button:hover,.controls a:hover,.exp-link:hover{background:#303030}
.next-label{padding:.5rem 1rem 0;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#888}
.right .stage-wrap{height:150px;flex:none;margin:.4rem 1rem}
.right .stage-wrap.ended .stage{visibility:hidden}
.next-end{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  border:1px dashed #333;color:#777;font-size:14px}
.stage-wrap.ended .next-end{display:flex}
.right .stage{border:1px solid #262626}
.controls{padding:.75rem 1rem;display:flex;flex-direction:column;gap:.5rem;border-top:1px solid #262626;border-bottom:1px solid #262626}
.controls button,.controls a{background:#262626;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;
  padding:.45rem .7rem;cursor:pointer;text-align:center;text-decoration:none;display:block}
.controls label{display:flex;align-items:center;gap:.4rem;font-size:14px}
.countdown-row{display:flex;gap:.4rem}
.countdown-row input{width:6.5em;background:#1a1a1a;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.4rem}
.live-link-row{display:flex;gap:.4rem}
.live-link-row input{flex:1;min-width:0;background:#1a1a1a;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.4rem}
.live-note{font-size:12px;color:#999}
.slide-list{padding:.5rem 1rem 1rem;font-size:13px;color:#ccc}
.slide-list-item{padding:.35rem .4rem;border-radius:5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slide-list-item:hover{background:#1a1a1a}
.slide-list-item.active{background:#26365e;color:#fff}

.design-wrap{border-top:1px solid #262626;padding:.5rem 1rem}
.design-toggle-row button{width:100%;text-align:left;padding:.45rem .7rem;font-size:14px}
.design-panel{padding:.5rem 0 0;display:flex;flex-direction:column;gap:.4rem}
.d-row{display:flex;align-items:center;gap:.5rem;font-size:13px}
.d-row label{flex:0 0 auto;min-width:96px;color:#ccc}
.d-row select,.d-row input[type=text]{flex:1;min-width:0;background:#1a1a1a;color:#f2f2f2;border:1px solid #3a3a3a;
  border-radius:5px;padding:.3rem .4rem}
.d-row input[type=color]{width:36px;height:28px;padding:0;border:1px solid #3a3a3a;border-radius:5px;background:#1a1a1a}
.d-row input[type=range]{flex:1}
.d-row button{background:#262626;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:5px;padding:.25rem .5rem;
  cursor:pointer;font-size:12px}
.d-group-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-top:.4rem}
.d-hint{font-size:12px;color:#999}
.d-save-msg{font-size:12px;color:#8fd48f;min-height:1em}
.export-wrap{border-top:1px solid #262626;padding:.5rem 1rem;display:flex;flex-direction:column;gap:.4rem}
.exp-row{display:flex;gap:.5rem;align-items:center}
.exp-link{background:#262626;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:6px;padding:.35rem .6rem;
  text-decoration:none;font-size:13px;text-align:center}
.exp-row select{background:#1a1a1a;color:#f2f2f2;border:1px solid #3a3a3a;border-radius:5px;padding:.3rem}

body.print-mode{background:#fff;margin:0}
.print-page{page-break-after:always}
body.print-mode:not(.print-notes) .print-page{width:1600px;height:900px;position:relative;overflow:hidden}
body.print-mode:not(.print-notes) .print-stage-wrap{width:1600px;height:900px;position:relative}
body.print-mode:not(.print-notes) .print-stage-wrap .stage{position:absolute;inset:0}
body.print-mode.print-notes .print-page{width:720px}
body.print-mode.print-notes .print-stage-wrap{width:720px;height:405px;position:relative;overflow:hidden;
  margin-bottom:1rem;background:#000}
body.print-mode.print-notes .print-stage-wrap .stage{top:0;left:0;transform:scale(.45);transform-origin:0 0}
body.print-mode.print-notes .print-notes-block{font-size:14px;line-height:1.5;color:#111}
`;

export function renderPlayer(opts: PlayerOptions): string {
  const deckData = safeJson({
    title: opts.title,
    version: opts.version,
    slides: opts.slides,
    design: opts.design,
  });
  const metaJson = safeJson({
    themeColors: THEME_COLORS,
    marginPx: MARGIN_PX,
    logoPx: LOGO_PX,
    titlePx: TITLE_PX,
    speedMs: SPEED_MS,
  });
  const stageSkeletonJson = safeJson(STAGE_INNER);
  const modeJson = safeJson(opts.mode);
  const downloadJson = safeJson(opts.downloadUrl ?? null);
  const safeTitle = escapeHtml(opts.title || "Untitled");
  const titlePlaceholder = escapeHtml(opts.title || "Untitled");

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
  <div class="stage-wrap" id="a-wrap">
    <div class="stage" id="a-stage-0">${STAGE_INNER}</div>
    <div class="stage" id="a-stage-1">${STAGE_INNER}</div>
  </div>
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
      <span id="p-countdown" style="display:none"></span>
    </div>
    <span id="p-clock"></span>
  </div>
  <div class="main">
    <div class="left">
      <div class="stage-wrap" id="p-wrap"><div class="stage" id="p-stage">${STAGE_INNER}</div></div>
      <div class="notes" id="p-notes"></div>
    </div>
    <div class="right">
      <div class="next-label" id="n-label">Next</div>
      <div class="stage-wrap" id="n-wrap"><div class="stage" id="n-stage">${STAGE_INNER}</div><div class="next-end">End of presentation</div></div>
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
      <div class="design-wrap" id="design-wrap" style="display:none">
        <div class="design-toggle-row"><button id="design-toggle" type="button" aria-expanded="false">&#9656; Design</button></div>
        <div class="design-panel" id="design-panel" style="display:none">
          <div class="d-row"><label>Theme</label><select id="d-theme">${THEME_OPTS}</select></div>
          <div class="d-row"><label>Text color</label><input type="color" id="d-textcolor"><button id="d-textcolor-reset" type="button">Theme</button></div>
          <div class="d-row"><label>Heading color</label><input type="color" id="d-headingcolor"><button id="d-headingcolor-reset" type="button">Theme</button></div>
          <div class="d-group-label">Logo</div>
          <div class="d-row"><label>Image</label><select id="d-logo-src"><option value="">None</option></select></div>
          <div class="d-hint" id="d-logo-hint" style="display:none">Attach an image to this item to use it here.</div>
          <div class="d-row"><label>Corner</label><select id="d-logo-corner">${CORNER_OPTS}</select></div>
          <div class="d-row"><label>Margin</label><select id="d-logo-margin">${SIZE_OPTS}</select></div>
          <div class="d-row"><label>Size</label><select id="d-logo-size">${SIZE_OPTS}</select></div>
          <div class="d-row"><label>Hide on slides</label><input type="text" id="d-logo-skip" placeholder="e.g. 1, 5-7"></div>
          <div class="d-group-label">Background</div>
          <div class="d-row"><label>Color</label><input type="color" id="d-bg-color"><button id="d-bg-color-reset" type="button">Reset</button></div>
          <div class="d-row"><label>Image</label><select id="d-bg-image"><option value="">None</option></select></div>
          <div class="d-row"><label>Darken</label><input type="range" id="d-bg-darken" min="0" max="90"><span id="d-bg-darken-out"></span></div>
          <div class="d-row"><label>Full brightness</label><input type="text" id="d-bg-full" placeholder="e.g. 1, 5-7"></div>
          <div class="d-group-label">Title bar</div>
          <div class="d-row"><label><input type="checkbox" id="d-tb-enabled"> Enabled</label></div>
          <div class="d-row"><label>Text</label><input type="text" id="d-tb-text" placeholder="${titlePlaceholder}"></div>
          <div class="d-row"><label>Position</label><select id="d-tb-position"><option value="top">Top</option><option value="bottom">Bottom</option></select></div>
          <div class="d-row"><label>Size</label><select id="d-tb-size">${SIZE_OPTS}</select></div>
          <div class="d-row"><label>Margin</label><select id="d-tb-margin">${SIZE_OPTS}</select></div>
          <div class="d-row"><label>Hide on slides</label><input type="text" id="d-tb-skip" placeholder="e.g. 1, 5-7"></div>
          <div class="d-group-label">Transition</div>
          <div class="d-row"><label>Effect</label><select id="d-tr-effect">${EFFECT_OPTS}</select></div>
          <div class="d-row"><label>Speed</label><select id="d-tr-speed">${SPEED_OPTS}</select></div>
          <div class="d-hint">Changes save automatically.</div>
          <div class="d-row"><button id="d-save-default" type="button">Save as my default</button></div>
          <div class="d-save-msg" id="d-save-msg"></div>
        </div>
      </div>
      <div class="export-wrap" id="export-wrap" style="display:none">
        <div class="d-group-label">Export</div>
        <a id="exp-pptx" class="exp-link">PowerPoint</a>
        <a id="exp-pro" class="exp-link">ProPresenter</a>
        <div class="d-hint">Text file: in ProPresenter use File &rarr; Import</div>
        <div class="exp-row"><a id="exp-pdf" class="exp-link" href="#">PDF</a><a id="exp-pdf-notes" class="exp-link" href="#">PDF with notes</a></div>
        <div class="exp-row"><button id="exp-images" type="button">Images</button><select id="exp-images-fmt"><option value="png">PNG</option><option value="jpg">JPG</option></select></div>
        <div class="d-hint" id="exp-progress"></div>
      </div>
      <div class="slide-list" id="slide-list"></div>
    </div>
  </div>
</div>
<script>
(function(){
"use strict";
var DECK = JSON.parse(document.getElementById("deck").textContent);
var META = ${metaJson};
var STAGE_SKELETON = ${stageSkeletonJson};
var PAGE_CSS = ${safeJson(CSS)};
var MODE = ${modeJson}; // "owner" | "offline" | "follow"
var DOWNLOAD_URL = ${downloadJson};

var role = document.documentElement.dataset.role === "audience" ? "audience" : "presenter";
var state = { i: 0, step: 0, blank: "", countdownEnd: null, build: false };
var audienceWin = null;
var KNOWN_PEER = null;
var liveToken = null; // owner mode only: the token of the "Go live" link, if any
var liveEnded = false; // follow mode only: stops polling once the link 404s
var audienceActive = 0; // which of the two audience stage layers is on top
var audienceSlideKey = null; // last slide index rendered to the audience, or null before first paint
var presenterKey = null; // last slide index rendered to the presenter's current stage
// Last build step painted on each side: a re-render of the same step (a poll, a
// resize, a design tweak) must not replay the newest item's fade-in.
var audienceStepKey = null, presenterStepKey = null;
var runningAnims = [];

// Build lists rides the synced state so the audience window reveals the same steps.
try { state.build = localStorage.getItem("ledgr-present-build-lists") === "1"; } catch (e) {}

function $(sel) { return document.getElementById(sel); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function slideCount() { return DECK.slides.length; }
function escapeHtmlJs(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function firstLine(html) {
  var d = document.createElement("div"); d.innerHTML = html;
  var t = (d.textContent || "").trim().replace(/\\s+/g, " ");
  return t.slice(0, 60) || "(empty)";
}
function send(win, data) { if (win) { try { win.postMessage(data, "*"); } catch (e) {} } }
function prefersReducedMotion() {
  try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
}

// ---- design: colors, "1, 5-7" slide lists, and painting one stage's layers -
function designColorsJs(d) {
  var t = META.themeColors[d.theme];
  return { bg: d.background.color || t.bg, text: d.textColor || t.text, heading: d.headingColor || t.heading };
}
function inSlideListJs(spec, n) {
  if (!spec) return false;
  var parts = spec.split(",");
  for (var i = 0; i < parts.length; i++) {
    var m = /^\\s*(\\d+)\\s*(?:-\\s*(\\d+)\\s*)?$/.exec(parts[i]);
    if (m) {
      var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (n >= a && n <= b) return true;
    }
  }
  return false;
}
function applyDesignToStage(stageEl, design, slideNumber) {
  var colors = designColorsJs(design);
  var bg = stageEl.querySelector(".stage-bg");
  var overlay = stageEl.querySelector(".stage-overlay");
  var inner = stageEl.querySelector(".stage-inner");
  var logoWrap = stageEl.querySelector(".stage-logo");
  var tbar = stageEl.querySelector(".stage-titlebar");
  var isImageLayout = stageEl.classList.contains("layout-image");

  stageEl.style.background = colors.bg;
  inner.style.color = colors.text;
  inner.style.setProperty("--heading-color", colors.heading);

  if (design.background.image) {
    bg.style.display = "block";
    bg.style.backgroundImage = 'url("' + design.background.image.replace(/"/g, "") + '")';
    var full = inSlideListJs(design.background.fullBrightness, slideNumber);
    overlay.style.display = full ? "none" : "block";
    overlay.style.opacity = String(design.background.darken / 100);
  } else {
    bg.style.display = "none";
    overlay.style.display = "none";
  }

  var hideLogo = !design.logo.src || inSlideListJs(design.logo.skip, slideNumber);
  if (hideLogo) {
    logoWrap.style.display = "none";
  } else {
    logoWrap.style.display = "block";
    var img = logoWrap.querySelector("img");
    img.src = design.logo.src;
    var maxPx = META.logoPx[design.logo.size];
    img.style.maxHeight = maxPx + "px"; img.style.maxWidth = maxPx + "px";
    var lm = META.marginPx[design.logo.margin];
    logoWrap.style.top = ""; logoWrap.style.bottom = ""; logoWrap.style.left = ""; logoWrap.style.right = "";
    if (design.logo.corner.charAt(0) === "t") logoWrap.style.top = lm + "px"; else logoWrap.style.bottom = lm + "px";
    if (design.logo.corner.charAt(1) === "l") logoWrap.style.left = lm + "px"; else logoWrap.style.right = lm + "px";
  }

  var hideBar = !design.titleBar.enabled || inSlideListJs(design.titleBar.skip, slideNumber);
  if (hideBar) {
    tbar.style.display = "none";
  } else {
    var barPx = META.titlePx[design.titleBar.size];
    var barMargin = META.marginPx[design.titleBar.margin];
    tbar.style.display = "flex";
    tbar.textContent = design.titleBar.text || DECK.title;
    tbar.style.fontSize = barPx + "px";
    tbar.style.color = colors.heading;
    tbar.style.left = barMargin + "px"; tbar.style.right = barMargin + "px";
    tbar.style.top = ""; tbar.style.bottom = "";
    if (design.titleBar.position === "top") tbar.style.top = barMargin + "px"; else tbar.style.bottom = barMargin + "px";
  }

  if (isImageLayout) {
    inner.style.padding = "";
  } else {
    var padTop = 80, padBottom = 80;
    if (!hideBar) {
      var extra = META.titlePx[design.titleBar.size] * 1.4 + META.marginPx[design.titleBar.margin];
      if (design.titleBar.position === "top") padTop = extra; else padBottom = extra;
    }
    inner.style.paddingTop = padTop + "px";
    inner.style.paddingBottom = padBottom + "px";
    inner.style.paddingLeft = "80px";
    inner.style.paddingRight = "80px";
  }
}

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
  // Unrevealed items keep their space (visibility, not display), so the heading
  // and earlier items never move and fitText sizes the finished slide once.
  if (lis.length && typeof step === "number") {
    lis.forEach(function (li, idx) { li.classList.toggle("build-hidden", idx > step); });
  }
  if (layout !== "image") {
    var startSize = layout === "big" ? 120 : layout === "quote" ? 72 : 56;
    fitText(inner, startSize, 14);
  }
  return lis.length;
}
function revealLastListItem(stageEl) {
  if (!state.build) return;
  var lis = listItems(stageEl.querySelector(".stage-inner"));
  var li = lis[state.step];
  if (li) li.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
    { duration: 180, easing: "ease-out" });
}
function baseTransform(stage) { return "translate(-50%,-50%) scale(" + (stage.dataset.scale || "1") + ")"; }
function scaleStage(wrap, stage) {
  var scale = Math.min(wrap.clientWidth / 1600, wrap.clientHeight / 900);
  stage.dataset.scale = String(scale);
  stage.style.transform = baseTransform(stage);
}
function currentListCount() {
  if (!state.build) return 0;
  var s = DECK.slides[state.i];
  if (!s) return 0;
  var d = document.createElement("div"); d.innerHTML = s.html;
  return listItems(d).length;
}
function mountDesignedStage(stageEl, slide, slideNumber, step) {
  var n = mountStage(stageEl, slide ? slide.html : "", step);
  applyDesignToStage(stageEl, DECK.design, slideNumber);
  return n;
}

// ---- transitions: two stacked layers + the Web Animations API, so this also
// works from a file:// download (View Transitions do not) --------------------
var pendingSwap = null; // "fade out, then in" mid-dip: completes it before a new transition
function stopRunning() {
  if (pendingSwap) pendingSwap();
  runningAnims.forEach(function (a) { try { a.finish(); } catch (e) {} });
  runningAnims = [];
}
function runAnim(el, keyframes, dur, easing) {
  // No fill: the inline styles playTransition sets already equal each end frame,
  // and a held fill would pin the old scale (transform) past a later resize.
  var a = el.animate(keyframes, { duration: dur, easing: easing });
  runningAnims.push(a);
  return a.finished["catch"](function () {});
}
function playTransition(oldEl, newEl, effect, dur) {
  stopRunning();
  var easing = "cubic-bezier(0.2, 0, 0, 1)";
  newEl.style.zIndex = "2"; oldEl.style.zIndex = "1";
  newEl.style.opacity = "1"; newEl.style.clipPath = ""; newEl.style.transform = baseTransform(newEl);
  if (effect === "none") { oldEl.style.opacity = "0"; return; }
  // Fades lay the new slide over an old one that stays fully opaque, then drop
  // the old one. Fading both at once let the black page show through mid-way,
  // so an unchanged background visibly dimmed on every slide change.
  function dropOld(a) { a.then(function () { if (newEl.style.zIndex === "2") oldEl.style.opacity = "0"; }); }
  if (effect === "fade") {
    oldEl.style.opacity = "1";
    dropOld(runAnim(newEl, [{ opacity: 0 }, { opacity: 1 }], dur, easing));
    return;
  }
  if (effect === "fade-black") {
    // "Fade out, then in": only the content dips; background, darken overlay,
    // logo and title bar hold steady. The fade-out holds with fill:"forwards"
    // until the layers swap (no flash of old text), then is cancelled.
    var half = dur / 2;
    var parts = function (el) { return Array.prototype.slice.call(el.querySelectorAll(".stage-inner")); };
    oldEl.style.opacity = "1"; newEl.style.opacity = "0";
    // Kept out of runningAnims: finish()ing a cancelled fill-forwards fade
    // re-applies it, stranding this layer's content at 0 when it's reused.
    var outs = parts(oldEl).map(function (p) {
      return p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: half, easing: easing, fill: "forwards" });
    });
    // The swap runs on a timer, not the animations' finished promises: a hidden
    // tab (a locked phone) freezes animations, and a stalled promise would leave
    // the old slide up. A newer transition runs a pending swap first (stopRunning).
    var swapped = false;
    var swap = function () {
      if (swapped) return;
      swapped = true;
      pendingSwap = null;
      clearTimeout(swapTimer);
      outs.forEach(function (a) { a.cancel(); });
      newEl.style.opacity = "1"; oldEl.style.opacity = "0";
      parts(newEl).forEach(function (p) {
        runningAnims.push(p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: half, easing: easing }));
      });
    };
    pendingSwap = swap;
    var swapTimer = setTimeout(swap, half);
    return;
  }
  if (effect === "fade-up" || effect === "fade-down") {
    var dy = effect === "fade-up" ? 24 : -24;
    oldEl.style.opacity = "1";
    dropOld(runAnim(newEl, [
      { opacity: 0, transform: baseTransform(newEl) + " translateY(" + dy + "px)" },
      { opacity: 1, transform: baseTransform(newEl) },
    ], dur, easing));
    return;
  }
  if (effect === "wipe-up" || effect === "wipe-down") {
    oldEl.style.opacity = "1"; newEl.style.opacity = "1";
    var from = effect === "wipe-up" ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
    runAnim(newEl, [{ clipPath: from }, { clipPath: "inset(0 0 0 0)" }], dur, easing).then(function () {
      oldEl.style.opacity = "0";
    });
    return;
  }
  if (effect === "grow") {
    oldEl.style.opacity = "1";
    dropOld(runAnim(newEl, [
      { opacity: 0, transform: baseTransform(newEl) + " scale(0.96)" },
      { opacity: 1, transform: baseTransform(newEl) },
    ], dur, easing));
    return;
  }
}

// ---- the render seam: everything on screen comes from state + DECK --------
function render() {
  if (role === "audience") renderAudience(); else renderPresenter();
}
function applyState(newState) {
  state = newState;
  render();
}

function renderAudience() {
  var wrap = $("a-wrap");
  var layers = [$("a-stage-0"), $("a-stage-1")];
  var blank = $("a-blank"), cd = $("a-countdown");
  var colors = designColorsJs(DECK.design);
  layers[audienceActive].style.zIndex = "2";
  layers[1 - audienceActive].style.zIndex = "1";

  if (state.blank === "black") {
    blank.style.display = "flex"; blank.style.background = colors.bg; blank.style.color = colors.text; blank.textContent = "";
    layers.forEach(function (l) { l.style.visibility = "hidden"; });
  } else if (state.blank === "title") {
    blank.style.display = "flex"; blank.style.background = colors.bg; blank.style.color = colors.heading; blank.textContent = DECK.title;
    layers.forEach(function (l) { l.style.visibility = "hidden"; });
  } else {
    blank.style.display = "none";
    layers.forEach(function (l) { l.style.visibility = "visible"; });
  }
  cd.style.display = state.countdownEnd ? "flex" : "none";
  cd.style.background = colors.bg;
  var cnum = cd.querySelector(".countdown-num");
  if (cnum) cnum.style.color = colors.heading;
  if (state.countdownEnd) updateCountdown();

  var slide = DECK.slides[state.i];
  var step = state.build ? state.step : null;

  var prevStep = audienceStepKey;
  audienceStepKey = state.step;
  if (audienceSlideKey === null) {
    audienceSlideKey = state.i;
    mountDesignedStage(layers[audienceActive], slide, state.i + 1, step);
    scaleStage(wrap, layers[audienceActive]);
    return;
  }
  if (audienceSlideKey === state.i) {
    var activeEl = layers[audienceActive];
    mountDesignedStage(activeEl, slide, state.i + 1, step);
    scaleStage(wrap, activeEl);
    if (state.step > prevStep) revealLastListItem(activeEl);
    return;
  }
  audienceSlideKey = state.i;
  var newIdx = 1 - audienceActive, newEl = layers[newIdx], oldEl = layers[audienceActive];
  mountDesignedStage(newEl, slide, state.i + 1, step);
  scaleStage(wrap, newEl);
  scaleStage(wrap, oldEl);
  var reduced = prefersReducedMotion();
  var effect = reduced ? "fade" : DECK.design.transition.effect;
  var dur = reduced ? 150 : META.speedMs[DECK.design.transition.speed];
  playTransition(oldEl, newEl, effect, dur);
  audienceActive = newIdx;
}

function renderPresenter() {
  $("p-count").textContent = "Slide " + (state.i + 1) + " / " + slideCount();
  var cur = DECK.slides[state.i], next = DECK.slides[state.i + 1];
  var pStage = $("p-stage"), nStage = $("n-stage");
  var revealed = presenterKey === state.i && state.step > presenterStepKey;
  presenterKey = state.i;
  presenterStepKey = state.step;
  var items = mountDesignedStage(pStage, cur, state.i + 1, state.build ? state.step : null);
  scaleStage($("p-wrap"), pStage);
  if (revealed) revealLastListItem(pStage);

  // "Next" previews what the next click shows: one more item on this slide
  // while a build has items left, else the next slide (as its build opens).
  var nWrap = $("n-wrap"), nLabel = $("n-label");
  var moreItems = state.build && state.step < items - 1;
  nWrap.classList.toggle("ended", !moreItems && !next);
  if (moreItems) {
    nLabel.textContent = "Next: item " + (state.step + 2) + " of " + items;
    mountDesignedStage(nStage, cur, state.i + 1, state.step + 1);
  } else {
    nLabel.textContent = next ? "Next slide" : "Next";
    mountDesignedStage(nStage, next, state.i + 2, state.build ? 0 : null);
  }
  scaleStage(nWrap, nStage);
  renderCountdownControls();
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
  var lastSeen = "";
  setInterval(function () {
    if (liveEnded) return;
    fetch(location.pathname + "?format=state", { cache: "no-store" })
      .then(function (r) {
        if (r.status === 404) { liveEnded = true; showEnded(); return null; }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        // Most polls change nothing; only a real change repaints.
        var seen = data.version + "|" + JSON.stringify(data.state);
        if (seen === lastSeen) return;
        lastSeen = seen;
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
    var text = m + ":" + (s < 10 ? "0" : "") + s;
    var el = document.querySelector("#a-countdown .countdown-num");
    if (el) el.textContent = text;
    var pc = $("p-countdown");
    if (pc) pc.textContent = "Countdown " + text;
  }, 250);
}
// Presenter side: the countdown only paints on the audience screen, so the bar
// mirrors it and the button flips to Stop while one runs.
function renderCountdownControls() {
  var running = !!state.countdownEnd;
  $("p-countdown").style.display = running ? "" : "none";
  $("start-countdown").textContent = running ? "Stop countdown" : "Start countdown";
  if (running) updateCountdown();
}

// ---- design panel: owner mode only, previews immediately, saves via POST --
function themeHex(theme, key) { return META.themeColors[theme][key]; }
function fieldsFromDesign(d) {
  $("d-theme").value = d.theme;
  $("d-textcolor").value = d.textColor || themeHex(d.theme, "text");
  $("d-headingcolor").value = d.headingColor || themeHex(d.theme, "heading");
  $("d-logo-src").value = d.logo.src || "";
  $("d-logo-corner").value = d.logo.corner;
  $("d-logo-margin").value = d.logo.margin;
  $("d-logo-size").value = d.logo.size;
  $("d-logo-skip").value = d.logo.skip;
  $("d-bg-color").value = d.background.color || themeHex(d.theme, "bg");
  $("d-bg-image").value = d.background.image || "";
  $("d-bg-darken").value = String(d.background.darken);
  $("d-bg-darken-out").textContent = d.background.darken + "%";
  $("d-bg-full").value = d.background.fullBrightness;
  $("d-tb-enabled").checked = d.titleBar.enabled;
  $("d-tb-text").value = d.titleBar.text;
  $("d-tb-position").value = d.titleBar.position;
  $("d-tb-size").value = d.titleBar.size;
  $("d-tb-margin").value = d.titleBar.margin;
  $("d-tb-skip").value = d.titleBar.skip;
  $("d-tr-effect").value = d.transition.effect;
  $("d-tr-speed").value = d.transition.speed;
}
// Every design change previews at once and saves itself a second after the
// last one, so the item (and a live link) always has what's on screen.
var designSaveTimer = null, designSaving = false;
function applyDesignChange() {
  render();
  send(KNOWN_PEER, { t: "deck", deck: DECK });
  if (MODE !== "owner" || location.protocol === "file:") return;
  clearTimeout(designSaveTimer);
  $("d-save-msg").textContent = "";
  designSaveTimer = setTimeout(function () { designSaveTimer = null; saveDesign(false); }, 1000);
}
function designPending() { return !!designSaveTimer || designSaving; }
function fillImageSelect(sel, images, current) {
  // A default design's logo usually lives on another item, so it isn't in this
  // item's list; keep it as a choice rather than showing "None".
  var known = !current || images.some(function (im) { return im.src === current; });
  sel.innerHTML = '<option value="">None</option>' +
    (known ? "" : '<option value="' + escapeHtmlJs(current) + '">Current image</option>') +
    images.map(function (im) {
      return '<option value="' + escapeHtmlJs(im.src) + '">' + escapeHtmlJs(im.filename) + "</option>";
    }).join("");
  sel.value = current || "";
}
var imageChoicesLoaded = false;
function loadImageChoices() {
  if (imageChoicesLoaded) return;
  imageChoicesLoaded = true;
  fetch(location.pathname + "?format=images")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var images = (data && data.images) || [];
      $("d-logo-hint").style.display = images.length ? "none" : "block";
      fillImageSelect($("d-logo-src"), images, DECK.design.logo.src);
      fillImageSelect($("d-bg-image"), images, DECK.design.background.image);
    })
    ["catch"](function () { imageChoicesLoaded = false; });
}
function saveDesign(asDefault) {
  var msg = $("d-save-msg");
  msg.textContent = "Saving\\u2026";
  designSaving = true;
  fetch(location.pathname + "/design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(asDefault ? { design: DECK.design, asDefault: true } : { design: DECK.design }),
  })
    .then(function (r) { if (!r.ok) throw new Error("save failed"); return r.json(); })
    .then(function () {
      designSaving = false;
      // Keep DECK.design as-is: the owner may have kept typing while this was
      // in flight, and the next autosave carries that.
      msg.textContent = asDefault ? "Saved as your default" : "Saved";
      setTimeout(function () { msg.textContent = ""; }, 2000);
      checkForDeckChange(); // picks up the new version so a live link refreshes now
    })
    ["catch"](function () { designSaving = false; msg.textContent = "Couldn't save"; });
}
function bindDesignPanel() {
  $("design-toggle").addEventListener("click", function () {
    var opening = $("design-panel").style.display === "none";
    $("design-panel").style.display = opening ? "flex" : "none";
    this.innerHTML = (opening ? "&#9662;" : "&#9656;") + " Design";
    this.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) loadImageChoices();
  });
  $("d-theme").addEventListener("change", function () { DECK.design.theme = this.value; fieldsFromDesign(DECK.design); applyDesignChange(); });
  $("d-textcolor").addEventListener("input", function () { DECK.design.textColor = this.value; applyDesignChange(); });
  $("d-textcolor-reset").addEventListener("click", function () { DECK.design.textColor = null; fieldsFromDesign(DECK.design); applyDesignChange(); });
  $("d-headingcolor").addEventListener("input", function () { DECK.design.headingColor = this.value; applyDesignChange(); });
  $("d-headingcolor-reset").addEventListener("click", function () { DECK.design.headingColor = null; fieldsFromDesign(DECK.design); applyDesignChange(); });
  $("d-logo-src").addEventListener("change", function () { DECK.design.logo.src = this.value || null; applyDesignChange(); });
  $("d-logo-corner").addEventListener("change", function () { DECK.design.logo.corner = this.value; applyDesignChange(); });
  $("d-logo-margin").addEventListener("change", function () { DECK.design.logo.margin = this.value; applyDesignChange(); });
  $("d-logo-size").addEventListener("change", function () { DECK.design.logo.size = this.value; applyDesignChange(); });
  $("d-logo-skip").addEventListener("input", function () { DECK.design.logo.skip = this.value; applyDesignChange(); });
  $("d-bg-color").addEventListener("input", function () { DECK.design.background.color = this.value; applyDesignChange(); });
  $("d-bg-color-reset").addEventListener("click", function () { DECK.design.background.color = null; fieldsFromDesign(DECK.design); applyDesignChange(); });
  $("d-bg-image").addEventListener("change", function () { DECK.design.background.image = this.value || null; applyDesignChange(); });
  $("d-bg-darken").addEventListener("input", function () {
    DECK.design.background.darken = parseInt(this.value, 10);
    $("d-bg-darken-out").textContent = this.value + "%";
    applyDesignChange();
  });
  $("d-bg-full").addEventListener("input", function () { DECK.design.background.fullBrightness = this.value; applyDesignChange(); });
  $("d-tb-enabled").addEventListener("change", function () { DECK.design.titleBar.enabled = this.checked; applyDesignChange(); });
  $("d-tb-text").addEventListener("input", function () { DECK.design.titleBar.text = this.value; applyDesignChange(); });
  $("d-tb-position").addEventListener("change", function () { DECK.design.titleBar.position = this.value; applyDesignChange(); });
  $("d-tb-size").addEventListener("change", function () { DECK.design.titleBar.size = this.value; applyDesignChange(); });
  $("d-tb-margin").addEventListener("change", function () { DECK.design.titleBar.margin = this.value; applyDesignChange(); });
  $("d-tb-skip").addEventListener("input", function () { DECK.design.titleBar.skip = this.value; applyDesignChange(); });
  $("d-tr-effect").addEventListener("change", function () { DECK.design.transition.effect = this.value; applyDesignChange(); });
  $("d-tr-speed").addEventListener("change", function () { DECK.design.transition.speed = this.value; applyDesignChange(); });
  $("d-save-default").addEventListener("click", function () { saveDesign(true); });
  fieldsFromDesign(DECK.design);
}

// ---- export group: PowerPoint/ProPresenter are plain links; PDF opens a
// print-layout tab; Images renders each slide off-screen and zips them ------
function initExportGroup() {
  $("export-wrap").style.display = "flex";
  var a = $("exp-pptx"); a.href = location.pathname + "?export=pptx";
  var b = $("exp-pro"); b.href = location.pathname + "?export=propresenter";
  $("exp-pdf").addEventListener("click", function (e) { e.preventDefault(); window.open(location.pathname + "?print=1", "_blank"); });
  $("exp-pdf-notes").addEventListener("click", function (e) { e.preventDefault(); window.open(location.pathname + "?print=notes", "_blank"); });
  $("exp-images").addEventListener("click", function () { exportImages($("exp-images-fmt").value); });
}
function strToBytes(s) { return new TextEncoder().encode(s); }
var CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// Store-only (no compression) zip: PNG/JPG bytes are already compressed, so a
// deflate implementation would only add code, not save space.
function buildZip(files) {
  var localParts = [], centralParts = [], offset = 0;
  files.forEach(function (f) {
    var nameBytes = strToBytes(f.name);
    var crc = crc32(f.data), size = f.data.length;
    var lh = new Uint8Array(30 + nameBytes.length), ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true); ldv.setUint16(4, 20, true); ldv.setUint16(6, 0, true);
    ldv.setUint16(8, 0, true); ldv.setUint16(10, 0, true); ldv.setUint16(12, 0, true);
    ldv.setUint32(14, crc, true); ldv.setUint32(18, size, true); ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true); ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    localParts.push(lh, f.data);

    var ch = new Uint8Array(46 + nameBytes.length), cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(4, 20, true); cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0, true); cdv.setUint16(10, 0, true); cdv.setUint16(12, 0, true); cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true); cdv.setUint32(20, size, true); cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true); cdv.setUint16(30, 0, true); cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true); cdv.setUint16(36, 0, true); cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centralParts.push(ch);
    offset += lh.length + f.data.length;
  });
  var centralSize = centralParts.reduce(function (s, p) { return s + p.length; }, 0);
  var end = new Uint8Array(22), edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true); edv.setUint16(4, 0, true); edv.setUint16(6, 0, true);
  edv.setUint16(8, files.length, true); edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true); edv.setUint32(16, offset, true); edv.setUint16(20, 0, true);
  return new Blob(localParts.concat(centralParts, [end]), { type: "application/zip" });
}
function downloadBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
}
function renderSlideToBlob(deck, i, fmt) {
  return new Promise(function (resolve, reject) {
    var holder = document.createElement("div");
    holder.innerHTML = '<div class="stage" style="position:static;transform:none">' + STAGE_SKELETON + "</div>";
    var stage = holder.firstChild;
    mountStage(stage, deck.slides[i].html, null);
    applyDesignToStage(stage, deck.design, i + 1);
    var xml = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1600 900">' +
      '<foreignObject width="1600" height="900"><div xmlns="http://www.w3.org/1999/xhtml"><style><![CDATA[' +
      PAGE_CSS + "]]></style>" + new XMLSerializer().serializeToString(stage) + "</div></foreignObject></svg>";
    // A data: URL, not a blob: one: Chrome taints the canvas for a blob-loaded
    // foreignObject SVG, which would block the export. XMLSerializer, not
    // outerHTML, because the SVG is XML and an unclosed <img> or <br> breaks it.
    var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = 1920; canvas.height = 1080;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, 1920, 1080);
      try {
        canvas.toBlob(function (blob) {
          if (!blob) return reject(new Error("tainted canvas"));
          resolve(blob);
        }, fmt === "jpg" ? "image/jpeg" : "image/png", 0.92);
      } catch (e) { reject(e); }
    };
    img.onerror = function () { reject(new Error("svg render failed")); };
    img.src = url;
  });
}
function exportImages(fmt) {
  var btn = $("exp-images"), progress = $("exp-progress");
  btn.disabled = true;
  fetch(location.pathname + "?format=json&inline=1")
    .then(function (r) { return r.json(); })
    .then(function (deck) {
      var files = [], total = deck.slides.length, ext = fmt === "jpg" ? "jpg" : "png";
      function pad2(n) { return (n < 10 ? "0" : "") + n; }
      function renderOne(i) {
        if (i >= total) return Promise.resolve();
        progress.textContent = "Rendering " + (i + 1) + " of " + total + "\\u2026";
        return renderSlideToBlob(deck, i, fmt)
          .then(function (blob) { return blob.arrayBuffer(); })
          .then(function (buf) {
            files.push({ name: "slide-" + pad2(i + 1) + "." + ext, data: new Uint8Array(buf) });
            return renderOne(i + 1);
          });
      }
      return renderOne(0).then(function () {
        downloadBlob(buildZip(files), (deck.title || "deck") + ".zip");
        progress.textContent = "";
      });
    })
    ["catch"](function () { progress.textContent = "Couldn't export images."; })
    .then(function () { btn.disabled = false; });
}

// ---- print mode (?print=1 / ?print=notes): every slide as a stacked page,
// build lists fully shown, no transitions; waits for images then prints -----
function initPrintMode(withNotes) {
  document.body.className = "print-mode" + (withNotes ? " print-notes" : "");
  document.body.innerHTML = "";
  var frag = document.createDocumentFragment();
  DECK.slides.forEach(function (slide, idx) {
    var page = document.createElement("div");
    page.className = "print-page";
    var stageWrap = document.createElement("div");
    stageWrap.className = "print-stage-wrap";
    stageWrap.innerHTML = '<div class="stage">' + STAGE_SKELETON + "</div>";
    var stage = stageWrap.firstChild;
    mountStage(stage, slide.html, null);
    applyDesignToStage(stage, DECK.design, idx + 1);
    page.appendChild(stageWrap);
    if (withNotes) {
      var notes = document.createElement("div");
      notes.className = "print-notes-block";
      notes.innerHTML = slide.notesHtml || "";
      page.appendChild(notes);
    }
    frag.appendChild(page);
  });
  document.body.appendChild(frag);
  // Page size per mode: a slide per landscape page, or a portrait handout
  // (720px = letter width inside half-inch margins, so the .45 slide fits).
  var pageCss = document.createElement("style");
  pageCss.textContent = withNotes ? "@page{size:letter portrait;margin:.5in}" : "@page{size:1600px 900px;margin:0}";
  document.head.appendChild(pageCss);
  var imgs = document.querySelectorAll("img");
  var pending = imgs.length;
  function done() { if (--pending <= 0) window.print(); }
  if (!pending) { window.print(); return; }
  imgs.forEach(function (img) {
    if (img.complete) done();
    else { img.addEventListener("load", done); img.addEventListener("error", done); }
  });
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
    if (state.countdownEnd) { state.countdownEnd = null; broadcastAndRender(); return; }
    var input = $("countdown-min");
    var mins = parseFloat(input.value);
    if (!mins || mins <= 0) { input.focus(); return; }
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
    $("design-wrap").style.display = "block";
    bindDesignPanel();
    initExportGroup();
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

var printMode = new URLSearchParams(location.search).get("print");
if (printMode) {
  initPrintMode(printMode === "notes");
} else {
  if (role === "presenter") initPresenter(); else initAudience();
  // Re-fit on resize: entering full screen, dragging to the projector, and a first
  // render that ran before layout settled all change the box the stage scales into.
  window.addEventListener("resize", render);
  requestAnimationFrame(render);

  // ---- live edits: owner mode only, and never from a file:// download ----
  if (MODE === "owner" && location.protocol !== "file:") {
    setInterval(function () {
      if (document.visibilityState === "visible") checkForDeckChange();
    }, 5000);
  }
}

// Owner mode: refetch the deck when the item changed (an edit, or a design
// autosave), re-render, and hand the new version to the audience window and
// any live link. A design still being saved stays as the owner has it.
function checkForDeckChange() {
  fetch(location.pathname + "?format=json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || !data.version || data.version === DECK.version) return;
      if (designPending()) data.design = DECK.design;
      DECK = data;
      state.i = clamp(state.i, 0, slideCount() - 1);
      render();
      send(KNOWN_PEER, { t: "deck", deck: DECK });
      postLiveState();
    })
    .catch(function () {});
}
})();
</script>
</body>
</html>`;
}
