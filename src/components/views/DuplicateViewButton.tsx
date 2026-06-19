// Duplicate a view (UX pass). Built-in (system) views can't be edited, and there
// was no clone path, so a user who wanted a tweaked Today/Tasks view had to
// rebuild it from scratch — the spec's "built-in views are editable seeds" had
// no door. This clones any view (system or not) into a fresh, editable copy via
// the existing create endpoint, then lands on its edit page to customize.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ViewInput } from "@/lib/views";

export default function DuplicateViewButton({ input }: { input: ViewInput }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function run() {
    setState("busy");
    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, name: `${input.name} (copy)` }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { view } = await res.json();
      // Land on the copy's editor so customizing the seed is the next step.
      router.push(`/views/${view.id}/edit`);
    } catch {
      setState("error");
    }
  }

  return (
    <button
      onClick={run}
      disabled={state === "busy"}
      className="text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
    >
      {state === "error"
        ? "Failed, retry?"
        : state === "busy"
          ? "Duplicating…"
          : "Duplicate"}
    </button>
  );
}
