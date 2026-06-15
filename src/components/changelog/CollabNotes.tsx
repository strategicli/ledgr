// The 1/4 shared-notes scratchpad on the Changelog page. Brandon and Tyler both
// read and edit one markdown file committed to the repo (the shared medium
// across their separate deploys, like the changelog itself). Edits are local
// until Save, which commits the file; Clear empties it. We hold the file's blob
// sha so a Save that lands on top of the other person's edit fails loudly (409)
// instead of silently clobbering it.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import ConfirmButton from "@/components/ui/ConfirmButton";
import LazyMarkdownEditor from "@/components/markdown-editor/LazyMarkdownEditor";

type LoadState = "loading" | "ready" | "notconfigured" | "error";

// "Jun 15, 2:30 PM" in the viewer's own locale/timezone (this is a wall-clock
// signature for the person clicking, so the browser's zone is the right one).
const stampFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function CollabNotes({ configured, authorName }: { configured: boolean; authorName: string }) {
  const [state, setState] = useState<LoadState>(configured ? "loading" : "notconfigured");
  const [markdown, setMarkdown] = useState("");
  const [sha, setSha] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bumps to re-seed the editor after load/clear
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const editorRef = useRef<Editor | null>(null);

  // The fetch is inlined here (not a called helper) so every setState lands in
  // the post-await continuation, never synchronously in the effect body
  // (react-hooks/set-state-in-effect — the AddRelation/CaptureModal pattern).
  // Manual reload re-runs this by bumping reloadNonce.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/collab/notes", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { configured: boolean; markdown: string; sha: string | null };
        if (cancelled) return;
        if (!data.configured) {
          setState("notconfigured");
          return;
        }
        setMarkdown(data.markdown);
        setSha(data.sha);
        setVersion((v) => v + 1);
        setDirty(false);
        setMessage(null);
        setState("ready");
      } catch {
        if (!cancelled) {
          setState("error");
          setMessage("Could not load notes.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, reloadNonce]);

  // Manual reload/retry: show the spinner now, then re-trigger the effect.
  const reload = useCallback(() => {
    setState("loading");
    setMessage(null);
    setReloadNonce((n) => n + 1);
  }, []);

  const commit = useCallback(
    async (nextMarkdown: string, reseed: boolean) => {
      setSaving(true);
      setMessage(null);
      try {
        const res = await fetch("/api/collab/notes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: nextMarkdown, sha }),
        });
        if (res.status === 409) {
          setMessage("Someone else edited these notes. Reload to get the latest, then redo your change.");
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { sha: string };
        setSha(data.sha);
        setMarkdown(nextMarkdown);
        setDirty(false);
        if (reseed) setVersion((v) => v + 1);
        setMessage("Saved.");
      } catch {
        setMessage("Save failed. Try again.");
      } finally {
        setSaving(false);
      }
    },
    [sha]
  );

  // Clearing the shared notes is confirmed in-context (the Clear button is a
  // ConfirmButton); this just commits the empty file.
  const clearNotes = useCallback(() => commit("", true), [commit]);

  // Insert a bold "<name> · <when>:" stamp at the cursor so a note carries who
  // left it. Uses the editor directly when available (lands at the caret and
  // keeps focus); falls back to appending to the markdown if it isn't ready yet.
  const sign = useCallback(() => {
    const stamp = `${authorName} · ${stampFmt.format(new Date())}:`;
    const ed = editorRef.current;
    if (ed) {
      ed.chain()
        .focus()
        .insertContent([
          { type: "text", marks: [{ type: "bold" }], text: stamp },
          { type: "text", text: " " },
        ])
        .run();
      setDirty(true); // onChange also fires, but this is immediate
    } else {
      setMarkdown((prev) => {
        const base = prev.replace(/\s+$/, "");
        return `${base}${base ? "\n\n" : ""}**${stamp}** `;
      });
      setDirty(true);
    }
  }, [authorName]);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">Notes</h2>
          <p className="text-[11px] text-neutral-500">Shared between Brandon and Tyler.</p>
        </div>
        {state === "ready" && (
          <button onClick={reload} title="Reload notes" className="text-xs text-neutral-500 hover:text-neutral-300">
            Reload
          </button>
        )}
      </div>

      {state === "notconfigured" ? (
        <p className="px-3 py-4 text-xs text-neutral-500">
          Connect GitHub (set <code className="rounded bg-neutral-800 px-1">GITHUB_TOKEN</code>) to share notes.
        </p>
      ) : state === "loading" ? (
        <p className="px-3 py-4 text-xs text-neutral-500">Loading notes…</p>
      ) : state === "error" ? (
        <div className="px-3 py-4 text-xs text-neutral-500">
          <p>{message}</p>
          <button onClick={reload} className="mt-2 text-[var(--accent)] hover:underline">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="min-h-[12rem] text-sm">
            <LazyMarkdownEditor
              key={version}
              initialMarkdown={markdown}
              onEditorReady={(ed) => {
                editorRef.current = ed;
              }}
              onChange={(md) => {
                setMarkdown(md);
                setDirty(true);
              }}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
            <button
              onClick={sign}
              disabled={saving}
              title={`Insert "${authorName} · …" at the cursor`}
              className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
            >
              Sign
            </button>
            <button
              onClick={() => void commit(markdown, false)}
              disabled={!dirty || saving}
              className="rounded bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <ConfirmButton
              onConfirm={clearNotes}
              title="Clear all shared notes?"
              description="This commits an empty notes file for both of you."
              confirmLabel="Clear"
              align="right"
              disabled={saving}
              triggerClassName="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
              trigger="Clear"
            />
            {message && <span className="text-[11px] text-neutral-500">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}
