// LT2: the `{{` insert menu for live item tokens (ADR-139). Typing `{{` opens a
// small grouped popup of the recognized tokens (item-token-catalog.ts); picking
// one inserts the plain-text token (e.g. `{{item.due:long}}`), which the
// decoration then highlights. Hand-rolled over Tiptap's Suggestion utility with
// a positioned <div>, mirroring mention-suggestion.ts — no popup dependency
// (CLAUDE.md rule 5). Static catalog (no fetch), so the menu is instant and the
// extension is client-pure.
"use client";

import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  filterTokenOptions,
  type TokenOption,
} from "@/lib/editor/item-token-catalog";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// The token text a chosen option inserts, wrapped in braces.
function insertText(o: TokenOption): string {
  return `{{${o.token}}}`;
}

function suggestionConfig() {
  return {
    char: "{{",
    // No leading "@"-style disambiguation needed; "{{" is unambiguous enough.
    items: ({ query }: { query: string }): TokenOption[] =>
      filterTokenOptions(query).slice(0, 12),
    command: ({
      editor,
      range,
      props,
    }: {
      editor: import("@tiptap/core").Editor;
      range: { from: number; to: number };
      props: TokenOption;
    }) => {
      const text = insertText(props);
      editor.chain().focus().insertContentAt(range, text).run();
    },
    render: () => {
      let popup: HTMLDivElement | null = null;
      let items: TokenOption[] = [];
      let selected = 0;
      let cmd: SuggestionProps<TokenOption>["command"] | null = null;
      let onDocPointer: ((e: MouseEvent) => void) | null = null;

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
          empty.className = "ledgr-token-empty";
          empty.textContent = "No matching field";
          popup.appendChild(empty);
          return;
        }
        let lastGroup = "";
        items.forEach((it, i) => {
          if (it.group !== lastGroup) {
            lastGroup = it.group;
            const h = document.createElement("div");
            h.className = "ledgr-token-group";
            h.textContent = it.group;
            popup!.appendChild(h);
          }
          const row = document.createElement("button");
          row.type = "button";
          row.className = "ledgr-token-item" + (i === selected ? " is-selected" : "");
          row.innerHTML =
            `<span class="ledgr-token-item-label">${escapeHtml(it.label)}</span>` +
            `<span class="ledgr-token-item-hint">${escapeHtml(it.hint)}</span>`;
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

      const mount = () => {
        document.querySelectorAll(".ledgr-token-popup").forEach((n) => n.remove());
        popup = document.createElement("div");
        popup.className = "ledgr-token-popup";
        document.body.appendChild(popup);
        onDocPointer = (e: MouseEvent) => {
          if (popup && !popup.contains(e.target as Node)) close();
        };
        document.addEventListener("mousedown", onDocPointer, true);
      };

      return {
        onStart: (props: SuggestionProps<TokenOption>) => {
          items = props.items;
          selected = 0;
          cmd = props.command;
          mount();
          paint();
          place(props.clientRect?.() ?? null);
        },
        onUpdate: (props: SuggestionProps<TokenOption>) => {
          items = props.items;
          selected = 0;
          cmd = props.command;
          if (!popup) mount();
          paint();
          place(props.clientRect?.() ?? null);
        },
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
          const count = Math.max(items.length, 1);
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
        onExit: () => close(),
      };
    },
  };
}

// The extension: registers the `{{` Suggestion plugin. Add it to the editor's
// extensions after the mention extension.
export const ItemTokenSuggestion = Extension.create({
  name: "itemTokenSuggestion",
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...suggestionConfig(),
      }),
    ];
  },
});
