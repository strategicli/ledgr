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
          items = props.items;
          selected = 0;
          cmd = props.command;
          popup = document.createElement("div");
          popup.className = "ledgr-mention-popup";
          document.body.appendChild(popup);
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
            popup?.remove();
            popup = null;
            return true;
          }
          return false;
        },
        onExit: () => {
          popup?.remove();
          popup = null;
        },
      };
    },
  };
}
