// The "@" mention suggestion: queries /api/items (server-side title match,
// same source the BlockNote editor used) and shows a small popup. Hand-rolled
// over Tiptap's suggestion lifecycle with a positioned <div> — no popup
// library, keeping the dependency count down (CLAUDE.md rule 5). The items
// returned are { id, label }, which Mention's default command maps straight
// onto the node's attrs.
"use client";

import type { MentionOptions } from "@tiptap/extension-mention";
import type { SuggestionProps } from "@tiptap/suggestion";

type Item = { id: string; label: string };

async function fetchItems(query: string, selfId?: string): Promise<Item[]> {
  const params = new URLSearchParams({ limit: "10" });
  if (query) params.set("q", query);
  const res = await fetch(`/api/items?${params}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items: { id: string; title: string }[];
  };
  return data.items
    .filter((it) => it.id !== selfId)
    .map((it) => ({ id: it.id, label: it.title || "Untitled" }));
}

export function createMentionSuggestion(
  selfId?: string
): MentionOptions["suggestion"] {
  return {
    items: ({ query }) => fetchItems(query, selfId),

    render: () => {
      let popup: HTMLDivElement | null = null;
      let items: Item[] = [];
      let selected = 0;
      let cmd: SuggestionProps<Item>["command"] | null = null;
      let onDocPointer: ((e: MouseEvent) => void) | null = null;

      // One place to tear the popup down so every exit path (onExit, Escape,
      // click-away) also unregisters the document listener — otherwise a stray
      // listener leaks. The DOM node lives on document.body (outside React), so
      // if it isn't removed here nothing else will: that was the bug where the
      // "No matches" box survived clicking away and even a route change, until
      // a full refresh. See also the unmount sweep in MarkdownEditor.tsx.
      const close = () => {
        popup?.remove();
        popup = null;
        if (onDocPointer) {
          document.removeEventListener("mousedown", onDocPointer, true);
          onDocPointer = null;
        }
      };

      const paint = () => {
        if (!popup) return;
        popup.innerHTML = "";
        if (items.length === 0) {
          const empty = document.createElement("div");
          empty.className = "ledgr-mention-empty";
          empty.textContent = "No matches";
          popup.appendChild(empty);
          return;
        }
        items.forEach((it, i) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className =
            "ledgr-mention-item" + (i === selected ? " is-selected" : "");
          row.textContent = it.label;
          row.addEventListener("mousedown", (e) => {
            e.preventDefault();
            cmd?.(it);
          });
          popup!.appendChild(row);
        });
      };

      const place = (rect: DOMRect | null) => {
        if (!popup || !rect) return;
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
      };

      return {
        onStart: (props: SuggestionProps<Item>) => {
          // Defensive: clear any orphan popup left by a previous session that
          // didn't tear down cleanly (belt-and-suspenders with close()).
          document
            .querySelectorAll(".ledgr-mention-popup")
            .forEach((n) => n.remove());
          items = props.items;
          selected = 0;
          cmd = props.command;
          popup = document.createElement("div");
          popup.className = "ledgr-mention-popup";
          document.body.appendChild(popup);
          // Clicking anywhere outside the popup dismisses it. Tiptap's
          // suggestion only fires onExit when the matched range changes in the
          // doc, so a plain blur (click away, never finishing the @) never
          // closed it on its own. Capture phase so we see the click before it
          // is swallowed elsewhere; row clicks use mousedown and live inside
          // the popup, so they're excluded by the contains() check.
          onDocPointer = (e: MouseEvent) => {
            if (popup && !popup.contains(e.target as Node)) close();
          };
          document.addEventListener("mousedown", onDocPointer, true);
          paint();
          place(props.clientRect?.() ?? null);
        },
        onUpdate: (props: SuggestionProps<Item>) => {
          items = props.items;
          selected = 0;
          cmd = props.command;
          paint();
          place(props.clientRect?.() ?? null);
        },
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowDown") {
            selected = (selected + 1) % Math.max(items.length, 1);
            paint();
            return true;
          }
          if (event.key === "ArrowUp") {
            selected =
              (selected - 1 + Math.max(items.length, 1)) %
              Math.max(items.length, 1);
            paint();
            return true;
          }
          if (event.key === "Enter") {
            const it = items[selected];
            if (it) cmd?.(it);
            return true;
          }
          if (event.key === "Escape") {
            close();
            return true;
          }
          return false;
        },
        onExit: () => {
          close();
        },
      };
    },
  };
}
