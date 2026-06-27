// Multi-select state for a list surface (ADR-118). One client provider wraps a
// list region; server-rendered rows pass through as children and drop a
// SelectCheckbox (a client island) that reads/writes this context. The provider
// is handed the in-view ordered ids so it can do shift-click range select and
// select-all without each row registering itself.
//
// Why context (not lifting state into each page): the pages are server
// components; selection is inherently client. A thin client provider + client
// checkbox islands keep every list page server-rendered (the codebase norm)
// while sharing one selection across the rows and the floating action bar.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SelectionContextValue = {
  selected: ReadonlySet<string>;
  count: number;
  // The number of selectable rows in view (ids.length). Lets a control hide
  // itself when there's nothing to select.
  total: number;
  isSelected: (id: string) => boolean;
  // Toggle one id. With shiftKey, select the contiguous range from the last
  // toggled row to this one (in the list's visual order).
  toggle: (id: string, shiftKey?: boolean) => void;
  clear: () => void;
  selectAll: () => void;
  allSelected: boolean;
  // Select mode: off by default, so rows render with no checkbox and no
  // reserved space (the SelectModeToggle turns it on). Turning it off clears
  // the selection — leaving select mode is the natural "done/cancel".
  selectMode: boolean;
  setSelectMode: (on: boolean) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return ctx;
}

// Optional variant for components that may render outside a provider (e.g. a
// shared row used both in selectable and non-selectable contexts).
export function useSelectionOptional(): SelectionContextValue | null {
  return useContext(SelectionContext);
}

export default function SelectionProvider({
  ids,
  children,
}: {
  // The in-view rows' ids, in display order. Powers range-select + select-all.
  // May grow across a Load-more re-render; already-selected ids that scrolled
  // out of `ids` stay selected.
  ids: string[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectMode, setSelectModeState] = useState(false);
  const anchor = useRef<string | null>(null);

  const toggle = useCallback(
    (id: string, shiftKey = false) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (shiftKey && anchor.current) {
          const from = ids.indexOf(anchor.current);
          const to = ids.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            // A shift-click selects the whole span (Notion/Finder behavior),
            // never deselects — the anchor's state decides the fill.
            for (let i = lo; i <= hi; i += 1) next.add(ids[i]);
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [ids]
  );

  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(ids));
  }, [ids]);

  // Leaving select mode clears the selection (and the range anchor) so the next
  // entry starts clean; entering just flips the flag.
  const setSelectMode = useCallback((on: boolean) => {
    setSelectModeState(on);
    if (!on) {
      anchor.current = null;
      setSelected(new Set());
    }
  }, []);

  const value = useMemo<SelectionContextValue>(() => {
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    return {
      selected,
      count: selected.size,
      total: ids.length,
      isSelected: (id) => selected.has(id),
      toggle,
      clear,
      selectAll,
      allSelected,
      selectMode,
      setSelectMode,
    };
  }, [selected, ids, toggle, clear, selectAll, selectMode, setSelectMode]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}
