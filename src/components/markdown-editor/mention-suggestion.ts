// The "@" mention suggestion: queries /api/items (server-side title match,
// same source the BlockNote editor used) and shows a small popup. Hand-rolled
// over Tiptap's suggestion lifecycle with a positioned <div> — no popup
// library, keeping the dependency count down (CLAUDE.md rule 5). The items
// returned are { id, label }, which Mention's default command maps straight
// onto the node's attrs.
//
// Create-on-miss (ADR-067): when the typed name matches nothing, a "Create"
// row makes an `unmarked` item (inbox=true, triaged later) and inserts a
// mention to it. The relation edge is NOT written here — mention edges are
// body-owned and diff-synced on save (src/lib/mentions.ts); inserting the
// mention node and letting the save create the edge keeps that contract.
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

// Create an `unmarked` item (the type is unknown from a free-text @) flagged
// for the Inbox, returning it as a mention Item.
async function createUnmarked(title: string): Promise<Item | null> {
  try {
    const res = await fetch(`/api/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "unmarked", title, inbox: true }),
    });
    if (!res.ok) return null;
    const { item } = (await res.json()) as {
      item: { id: string; title: string };
    };
    return { id: item.id, label: item.title || title };
  } catch {
    return null;
  }
}

export function createMentionSuggestion(
  selfId?: string
): MentionOptions["suggestion"] {
  return {
    items: ({ query }) => fetchItems(query, selfId),

    // Titles routinely contain spaces ("Roger Smith", "Elder Board Meeting"),
    // so the suggestion must NOT terminate at the first space — otherwise most
    // items are untypeable. Tiptap defaults allowSpaces to false; turn it on so
    // the query keeps growing across spaces until a row is picked or the match
    // breaks.
    allowSpaces: true,

    render: () => {
      let popup: HTMLDivElement | null = null;
      let items: Item[] = [];
      let query = "";
      let selected = 0;
      let creating = false;
      let cmd: SuggestionProps<Item>["command"] | null = null;
      let onDocPointer: ((e: MouseEvent) => void) | null = null;

      // Whether to show the create-on-miss row: a non-empty query with no
      // exact (case-insensitive) title match among the hits.
      const showCreate = () =>
        query.trim() !== "" &&
        !items.some(
          (it) => it.label.trim().toLowerCase() === query.trim().toLowerCase()
        );
      const rowCount = () => items.length + (showCreate() ? 1 : 0);

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

      // Create the unmarked item, then insert the mention to it. Guarded
      // against double-submit; cmd is captured at call time.
      const runCreate = async () => {
        if (creating || !query.trim()) return;
        creating = true;
        const insert = cmd;
        const made = await createUnmarked(query.trim());
        creating = false;
        if (made && insert) insert(made);
        else if (!made) paint(); // surface that nothing happened; let them retry
      };

      const paint = () => {
        if (!popup) return;
        popup.innerHTML = "";
        if (items.length === 0 && !showCreate()) {
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
        if (showCreate()) {
          const i = items.length;
          const row = document.createElement("button");
          row.type = "button";
          row.className =
            "ledgr-mention-item ledgr-mention-create" +
            (i === selected ? " is-selected" : "");
          row.textContent = creating
            ? `Creating “${query.trim()}”…`
            : `Create “${query.trim()}”`;
          row.addEventListener("mousedown", (e) => {
            e.preventDefault();
            void runCreate();
          });
          popup!.appendChild(row);
        }
      };

      const place = (rect: DOMRect | null) => {
        if (!popup || !rect) return;
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
      };

      // Build the popup + wire its click-away dismiss. Extracted so onUpdate can
      // re-open it after a space-led query closed it (e.g. "@ " then backspace),
      // not just onStart.
      const mount = () => {
        // Clear any orphan popup left by a previous session that didn't tear
        // down cleanly (belt-and-suspenders with close()).
        document
          .querySelectorAll(".ledgr-mention-popup")
          .forEach((n) => n.remove());
        popup = document.createElement("div");
        popup.className = "ledgr-mention-popup";
        document.body.appendChild(popup);
        // Clicking anywhere outside the popup dismisses it (capture phase so we
        // see the click before it's swallowed; row mousedowns live inside).
        onDocPointer = (e: MouseEvent) => {
          if (popup && !popup.contains(e.target as Node)) close();
        };
        document.addEventListener("mousedown", onDocPointer, true);
      };

      // "@" immediately followed by a space is plain text, not a mention ("email
      // me @ 3pm"), so the popup should stay shut. allowSpaces lets a space
      // *inside* a query through ("@Elder Board"); those queries never BEGIN
      // with a space, so a leading space is the unambiguous "this isn't a
      // mention" signal.
      const isLiteralAt = (query: string) => query.startsWith(" ");

      return {
        onStart: (props: SuggestionProps<Item>) => {
          items = props.items;
          query = props.query;
          selected = 0;
          creating = false;
          cmd = props.command;
          if (isLiteralAt(query)) return; // "@ …" — leave the @ as plain text
          mount();
          paint();
          place(props.clientRect?.() ?? null);
        },
        onUpdate: (props: SuggestionProps<Item>) => {
          items = props.items;
          query = props.query;
          selected = 0;
          cmd = props.command;
          // A space right after "@" means it isn't a mention — dismiss. (A space
          // later in the query doesn't begin with one, so multi-word titles are
          // unaffected.)
          if (isLiteralAt(query)) {
            close();
            return;
          }
          // Re-open if a previous space-led query had closed us but the user
          // backspaced into a real query again.
          if (!popup) mount();
          paint();
          place(props.clientRect?.() ?? null);
        },
        onKeyDown: ({ event }) => {
          const count = Math.max(rowCount(), 1);
          if (event.key === "ArrowDown") {
            selected = (selected + 1) % count;
            paint();
            return true;
          }
          if (event.key === "ArrowUp") {
            selected = (selected - 1 + count) % count;
            paint();
            return true;
          }
          if (event.key === "Enter") {
            if (selected < items.length) {
              const it = items[selected];
              if (it) cmd?.(it);
            } else if (showCreate()) {
              void runCreate();
            }
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
