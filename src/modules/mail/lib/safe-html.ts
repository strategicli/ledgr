// Incoming mail is hostile until proven otherwise (plan note a06242d3, "Risks").
// Three locks, any one of which stops a script:
//   1. DOMPurify strips scripts, event handlers, forms, frames and the like.
//   2. The page it lands in carries a Content-Security-Policy that allows no
//      scripts and no network at all, except images when the owner asks.
//   3. SafeMailBody shows it in an iframe sandboxed WITHOUT allow-scripts.
// Remote images are held back by default: they are how senders track opens.
//
// Pure: takes the DOMPurify instance, so the browser passes its own and the
// verify script passes one built on a server-side DOM.
import type { DOMPurify } from "dompurify";

export type MailDocument = { srcDoc: string; blockedImages: number };

const FORBID_TAGS = [
  "form", "input", "button", "textarea", "select", "option",
  "iframe", "frame", "frameset", "object", "embed", "applet",
  "base", "meta", "link", "audio", "video", "source", "track", "portal",
];

export function mailCsp(allowRemoteImages: boolean): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src data: cid:${allowRemoteImages ? " https: http:" : ""}`,
    "font-src data:",
    "form-action 'none'",
  ].join("; ");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function buildMailDocument(
  purify: DOMPurify,
  body: { html: string | null; text: string | null },
  opts: { allowRemoteImages: boolean }
): MailDocument {
  let blockedImages = 0;
  let inner: string;
  if (body.html && !purify.isSupported) {
    // DOMPurify hands input back UNTOUCHED when it has no DOM (a server
    // render). Fail closed: show nothing until the browser can clean it.
    inner = "";
  } else if (body.html) {
    purify.addHook("afterSanitizeAttributes", (node) => {
      const el = node as Element;
      if (el.tagName === "A" && el.hasAttribute("href")) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      if (el.tagName === "IMG") {
        el.removeAttribute("srcset");
        const src = el.getAttribute("src") ?? "";
        if (!opts.allowRemoteImages && /^(https?:)?\/\//i.test(src)) {
          el.setAttribute("data-blocked-src", src);
          el.removeAttribute("src");
          blockedImages++;
        }
      }
    });
    try {
      inner = purify.sanitize(body.html, {
        FORBID_TAGS,
        FORBID_ATTR: ["srcset", "ping", "formaction", "action"],
        ALLOW_DATA_ATTR: false,
        // cid: is how a message points at its own inline images.
        ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|cid|data:image\/(?:png|gif|jpe?g|webp)):?/i,
      });
    } finally {
      purify.removeHook("afterSanitizeAttributes");
    }
  } else {
    inner = `<div class="plain">${escapeHtml(body.text ?? "")}</div>`;
  }
  const srcDoc =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${mailCsp(opts.allowRemoteImages)}">` +
    `<meta name="referrer" content="no-referrer"><base target="_blank">` +
    `<style>html,body{margin:0;background:#fff;color:#111}body{padding:12px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}` +
    `img{max-width:100%;height:auto}.plain{white-space:pre-wrap}</style>` +
    `</head><body>${inner}</body></html>`;
  return { srcDoc, blockedImages };
}
