// The "/" slash-command menu — the first general command palette in the editor
// (mentions use "@", tokens use "{{"). Hand-rolled over Tiptap's Suggestion
// utility with a positioned <div>, mirroring token-suggestion.ts exactly, so
// there's no popup dependency (CLAUDE.md Principle 5). Commands run against the
// live editor and replace the "/query" range.
//
// The toggle command is gated by the user's toggleBlocksEnabled setting: the
// host calls setSlashToggleEnabled once settings load. It's a module-level flag
// (app-wide, one editor focused at a time), matching the memoized settings
// pattern in MarkdownEditor. Headings are core and always offered.
"use client";

import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { insertToggle } from "./toggle-extension";

// A unique key: @tiptap/suggestion defaults every instance to the same
// "suggestion$" key, so a second default-keyed Suggestion (the "{{" token menu
// already uses the default) throws "Adding different instances of a keyed
// plugin". Mentions have their own key; this gives the slash menu its own too.
const slashSuggestionKey = new PluginKey("slashCommands");

// App-wide toggle-blocks gate (see setSlashToggleEnabled). Defaults on to match
// DEFAULT_SETTINGS; the host pushes the real value once /api/settings resolves.
let toggleEnabled = true;
export function setSlashToggleEnabled(on: boolean): void {
  toggleEnabled = on;
}

type SlashCommand = {
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  enabled?: () => boolean;
  run: (editor: Editor, range: Range) => void;
};

const setHeading =
  (level: 1 | 2 | 3) => (editor: Editor, range: Range) => {
    editor.chain().focus().deleteRange(range).setNode("heading", { level }).run();
  };

const COMMANDS: SlashCommand[] = [
  {
    id: "h1",
    label: "Heading 1",
    hint: "Large section heading",
    keywords: ["h1", "heading", "title"],
    run: setHeading(1),
  },
  {
    id: "h2",
    label: "Heading 2",
    hint: "Medium section heading",
    keywords: ["h2", "heading", "subtitle"],
    run: setHeading(2),
  },
  {
    id: "h3",
    label: "Heading 3",
    hint: "Small section heading",
    keywords: ["h3", "heading"],
    run: setHeading(3),
  },
  {
    id: "toggle",
    label: "Toggle",
    hint: "Collapsible block",
    keywords: ["toggle", "details", "collapse", "expand", "fold"],
    enabled: () => toggleEnabled,
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      insertToggle(editor);
    },
  },
];

function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  return COMMANDS.filter((c) => c.enabled?.() ?? true).filter(
    (c) =>
      q === "" ||
      c.label.toLowerCase().includes(q) ||
      c.keywords.some((k) => k.includes(q))
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function suggestionConfig(editor: Editor) {
  return {
    editor,
    pluginKey: slashSuggestionKey,
    char: "/",
    // Fires only at the start of a block or after a space (Suggestion's default
    // allowedPrefixes), so a "/" inside "http://" or "and/or" won't open it.
    items: ({ query }: { query: string }): SlashCommand[] => filterCommands(query),
    command: ({
      editor,
      range,
      props,
    }: {
      editor: Editor;
      range: Range;
      props: SlashCommand;
    }) => {
      props.run(editor, range);
    },
    render: () => {
      let popup: HTMLDivElement | null = null;
      let items: SlashCommand[] = [];
      let selected = 0;
      let cmd: SuggestionProps<SlashCommand>["command"] | null = null;
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
          empty.className = "ledgr-slash-empty";
          empty.textContent = "No matching command";
          popup.appendChild(empty);
          return;
        }
        items.forEach((it, i) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "ledgr-slash-item" + (i === selected ? " is-selected" : "");
          row.innerHTML =
            `<span class="ledgr-slash-item-label">${escapeHtml(it.label)}</span>` +
            `<span class="ledgr-slash-item-hint">${escapeHtml(it.hint)}</span>`;
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
        document.querySelectorAll(".ledgr-slash-popup").forEach((n) => n.remove());
        popup = document.createElement("div");
        popup.className = "ledgr-slash-popup";
        document.body.appendChild(popup);
        onDocPointer = (e: MouseEvent) => {
          if (popup && !popup.contains(e.target as Node)) close();
        };
        document.addEventListener("mousedown", onDocPointer, true);
      };

      return {
        onStart: (props: SuggestionProps<SlashCommand>) => {
          items = props.items;
          selected = 0;
          cmd = props.command;
          mount();
          paint();
          place(props.clientRect?.() ?? null);
        },
        onUpdate: (props: SuggestionProps<SlashCommand>) => {
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

export const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    return [Suggestion(suggestionConfig(this.editor))];
  },
});
