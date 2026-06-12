// The only way pages may pull in the editor: a client-side dynamic import,
// so lists and Today never pay the BlockNote bundle (CLAUDE.md rule 8).
"use client";

import dynamic from "next/dynamic";
import type { EditorProps } from "./Editor";

const LazyEditor = dynamic<EditorProps>(() => import("./Editor"), {
  ssr: false,
  loading: () => (
    <div className="px-12 py-4 text-sm text-gray-400">Loading editor…</div>
  ),
});

export default LazyEditor;
