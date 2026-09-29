// The "/icon" picker (Tyler, 2026-09-29): a small popup at the caret with a
// search box, a size choice and Ledgr's icon grid. Picking one inserts its code
// (`:home:` or `:home:large:`) where the "/icon" was typed, which the page render
// draws as the icon (Website Pages). Hand-rolled DOM like the slash menu itself,
// so there is no popup dependency (Principle 5).
import type { Editor } from "@tiptap/core";
import { NAV_ICONS } from "@/lib/nav-icons";

const SIZES: { id: string; label: string }[] = [
  { id: "", label: "Text" },
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
  { id: "xl", label: "XL" },
];

let lastSize = "";

// Opened from "/icon" (insert at the caret) or from a click on an icon chip in
// the editor (replace that code: the chip's icon and size come preselected).
export type IconPickerOptions = { replace?: { from: number; to: number; name: string; size?: string } };

export function openIconPicker(editor: Editor, opts: IconPickerOptions = {}): void {
  document.querySelectorAll(".ledgr-icon-picker").forEach((n) => n.remove());
  const replace = opts.replace;
  if (replace) lastSize = replace.size && SIZES.some((sz) => sz.id === replace.size) ? replace.size : "";
  const at = replace ? replace.from : editor.state.selection.from;
  const coords = editor.view.coordsAtPos(at);
  const popup = document.createElement("div");
  popup.className = "ledgr-icon-picker";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Insert an icon");
  popup.style.left = `${Math.max(8, Math.min(coords.left, window.innerWidth - 340))}px`;
  popup.style.top = `${Math.min(coords.bottom + 6, window.innerHeight - 320)}px`;

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search icons";
  search.className = "ledgr-icon-picker-search";
  popup.appendChild(search);

  const sizes = document.createElement("div");
  sizes.className = "ledgr-icon-picker-sizes";
  popup.appendChild(sizes);
  const paintSizes = () => {
    sizes.innerHTML = "";
    for (const sz of SIZES) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = sz.label;
      b.className = sz.id === lastSize ? "is-selected" : "";
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        lastSize = sz.id;
        paintSizes();
      });
      sizes.appendChild(b);
    }
  };
  paintSizes();

  const grid = document.createElement("div");
  grid.className = "ledgr-icon-picker-grid";
  popup.appendChild(grid);

  // Editing an existing icon: a way to the raw code, and the current one marked.
  if (replace) {
    const raw = document.createElement("button");
    raw.type = "button";
    raw.className = "ledgr-icon-picker-raw";
    raw.textContent = "Edit as text";
    raw.addEventListener("mousedown", (e) => {
      e.preventDefault();
      close();
      editor.chain().focus().setTextSelection(replace.from + 1).run();
    });
    popup.appendChild(raw);
  }

  const close = () => {
    popup.remove();
    document.removeEventListener("mousedown", onOutside, true);
  };
  const pick = (key: string) => {
    close();
    if (replace) {
      editor.chain().focus().insertContentAt({ from: replace.from, to: replace.to }, `:${key}${lastSize ? `:${lastSize}` : ""}:`).run();
      return;
    }
    const code = `:${key}${lastSize ? `:${lastSize}` : ""}: `;
    editor.chain().focus().insertContentAt(at, code).run();
  };
  const paintGrid = () => {
    const q = search.value.trim().toLowerCase();
    grid.innerHTML = "";
    const keys = Object.keys(NAV_ICONS).filter((k) => !q || k.includes(q));
    if (!keys.length) {
      const none = document.createElement("div");
      none.className = "ledgr-icon-picker-empty";
      none.textContent = "No icon by that name";
      grid.appendChild(none);
    }
    for (const key of keys) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = `:${key}:`;
      if (replace && key === replace.name) b.className = "is-current";
      b.setAttribute("aria-label", key);
      b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${NAV_ICONS[key as keyof typeof NAV_ICONS]}</svg>`;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(key);
      });
      grid.appendChild(b);
    }
  };
  paintGrid();
  search.addEventListener("input", paintGrid);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      editor.commands.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const first = grid.querySelector("button");
      if (first) pick(first.getAttribute("aria-label") ?? "");
    }
  });
  const onOutside = (e: MouseEvent) => {
    if (!popup.contains(e.target as Node)) close();
  };
  document.addEventListener("mousedown", onOutside, true);
  document.body.appendChild(popup);
  search.focus();
}
