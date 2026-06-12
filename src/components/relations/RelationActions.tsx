// Per-row controls on the backlinks panel: un-relate a confirmed edge
// (remove the link, never the item — PRD §4.9), or confirm/reject a
// suggested one. Mention-only rows render no controls (the body owns those
// edges; removing the @-mention removes the link). No optimistic removal: a
// row can be linked by several edges, so the server re-render is the truth.
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const buttonClass =
  "shrink-0 rounded px-1 text-xs text-neutral-600 hover:bg-neutral-700 hover:text-neutral-200 disabled:opacity-50";

export default function RelationActions({
  itemId,
  otherId,
  suggested,
  removable,
}: {
  itemId: string;
  otherId: string;
  suggested: boolean;
  removable: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function run(action: "remove" | "confirm" | "reject") {
    if (state === "busy") return;
    setState("busy");
    try {
      const res =
        action === "confirm"
          ? await fetch(`/api/items/${itemId}/relations`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ targetId: otherId }),
            })
          : await fetch(
              `/api/items/${itemId}/relations?targetId=${otherId}${
                action === "reject" ? "&suggested=true" : ""
              }`,
              { method: "DELETE" }
            );
      if (!res.ok) throw new Error(String(res.status));
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  if (suggested) {
    return (
      <span className="flex shrink-0 items-center gap-0.5">
        {state === "error" && (
          <span className="text-xs text-red-400">failed</span>
        )}
        <button
          onClick={() => void run("confirm")}
          disabled={state === "busy"}
          title="Confirm this link"
          className={buttonClass}
        >
          ✓
        </button>
        <button
          onClick={() => void run("reject")}
          disabled={state === "busy"}
          title="Reject this suggestion"
          className={buttonClass}
        >
          ✕
        </button>
      </span>
    );
  }

  if (!removable) return null;

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {state === "error" && <span className="text-xs text-red-400">failed</span>}
      <button
        onClick={() => void run("remove")}
        disabled={state === "busy"}
        title="Un-relate (keeps both items)"
        className={`${buttonClass} opacity-0 focus:opacity-100 group-hover:opacity-100`}
      >
        ✕
      </button>
    </span>
  );
}
