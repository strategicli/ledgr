"use client";

// The only way a message body reaches the screen. See lib/safe-html.ts for the
// three locks. The iframe may share Ledgr's origin (so it can size itself to
// its content) only because it can never run a script: allow-same-origin is
// dangerous solely in combination with allow-scripts, which is never granted.
import DOMPurify from "dompurify";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildMailDocument } from "@/modules/mail/lib/safe-html";

const noop = () => () => {};

export default function SafeMailBody({ html, text }: { html: string | null; text: string | null }) {
  const [showImages, setShowImages] = useState(false);
  const [height, setHeight] = useState(200);
  const frame = useRef<HTMLIFrameElement>(null);
  // Browser only: the server has no DOM for DOMPurify, so it renders nothing.
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  const doc = useMemo(
    () => (inBrowser ? buildMailDocument(DOMPurify, { html, text }, { allowRemoteImages: showImages }) : null),
    [inBrowser, html, text, showImages]
  );
  if (!doc) return null;

  return (
    <div className="flex flex-col gap-2">
      {doc.blockedImages > 0 && !showImages && (
        <div className="flex items-center justify-between rounded-card border border-line bg-surface-1 px-3 py-2 ui-meta text-ink-muted">
          <span>Pictures from the internet are hidden so the sender can&apos;t tell you opened this.</span>
          <button type="button" className="text-ink underline" onClick={() => setShowImages(true)}>
            Show pictures
          </button>
        </div>
      )}
      <iframe
        ref={frame}
        title="Email message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={doc.srcDoc}
        style={{ height }}
        className="w-full rounded-card border border-line bg-white"
        onLoad={() => {
          const h = frame.current?.contentDocument?.documentElement.scrollHeight;
          if (h) setHeight(h + 2);
        }}
      />
    </div>
  );
}
