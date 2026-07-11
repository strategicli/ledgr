// A dependency-free `{{` autocomplete for plain <textarea>/<input> fields, so
// live item tokens (item-tokens.ts / ADR-139) can be inserted in the item TITLE
// (and any other plain text field) the same way the rich body editor already
// offers them (token-suggestion.ts). It REUSES the shared token catalog
// (item-token-catalog.ts) and the same `.ledgr-token-*` popup styling as the
// TipTap menu, so both surfaces look and behave alike. No popup dependency
// (CLAUDE.md principle 5).
//
// Usage: pass the field's ref and a setter for its whole value. Spread the
// returned handlers onto the field, render `menu` once nearby, and short-circuit
// the field's own keydown when `onKeyDown` returns true:
//   const ac = useTokenAutocomplete(ref, setValue);
//   <textarea onChange={(e)=>{ setValue(e.target.value); ac.sync(); }}
//             onKeyDown={(e)=>{ if (ac.onKeyDown(e)) return; /* field logic */ }}
//             onKeyUp={ac.sync} onClick={ac.sync} onBlur={ac.close}
//             onCompositionStart={ac.onCompositionStart}
//             onCompositionEnd={ac.onCompositionEnd} />
//   {ac.menu}
"use client";

import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  filterTokenOptions,
  type TokenOption,
} from "@/lib/editor/item-token-catalog";

type TextField = HTMLTextAreaElement | HTMLInputElement;
type Trigger = { from: number; query: string };

const MAX_ITEMS = 12;

// The text typed after the most recent unclosed "{{" up to the caret, with no
// intervening whitespace or brace — the live query. Null when the caret isn't in
// a "{{" context. Token expressions never contain spaces, so a space closes the
// menu (matching the rich editor's Suggestion default). The [^{}] class can't
// cross a closing "}}", so a completed token never re-triggers.
function triggerAt(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const m = before.match(/\{\{([^{}\s]*)$/);
  if (!m) return null;
  return { from: caret - m[0].length, query: m[1] };
}

export type TokenAutocomplete = {
  // The floating menu (or null when closed). Render it once near the field.
  menu: React.ReactNode;
  // Recompute the trigger from the field's current value + caret. Call on input
  // and on caret moves (keyup / click).
  sync: () => void;
  // Handle a keydown while the menu may be open. Returns true when it consumed
  // the key (the caller should stop — the event was already preventDefault'd).
  onKeyDown: (e: KeyboardEvent<TextField>) => boolean;
  // IME guards: pause while composing, re-sync when composition ends.
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  close: () => void;
  open: boolean;
};

export function useTokenAutocomplete(
  ref: RefObject<TextField | null>,
  // Replace the field's whole value (the caller wires this to its own state +
  // autosave). The hook restores focus and drops the caret after the token.
  setValue: (next: string) => void
): TokenAutocomplete {
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [selected, setSelected] = useState(0);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  // Mirrors `trigger` for synchronous reads inside sync()/handlers (avoids stale
  // closures without re-creating the callbacks on every keystroke).
  const triggerRef = useRef<Trigger | null>(null);
  // The trigger context the user dismissed with Escape; keeps the menu closed
  // until that context changes (they type more, or the caret leaves).
  const dismissed = useRef<Trigger | null>(null);
  const composing = useRef(false);
  const pendingCaret = useRef<number | null>(null);

  const items = useMemo(
    () => (trigger ? filterTokenOptions(trigger.query).slice(0, MAX_ITEMS) : []),
    [trigger]
  );

  const setActive = useCallback((next: Trigger | null) => {
    triggerRef.current = next;
    setTrigger(next);
  }, []);

  const close = useCallback(() => setActive(null), [setActive]);

  const sync = useCallback(() => {
    if (composing.current) return;
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? el.value.length;
    const t = triggerAt(el.value, caret);
    if (!t) {
      dismissed.current = null;
      if (triggerRef.current) setActive(null);
      return;
    }
    // Honor an Escape dismissal until the same context changes.
    const d = dismissed.current;
    if (d && d.from === t.from && d.query === t.query) return;
    dismissed.current = null;
    const prev = triggerRef.current;
    const changed = !prev || prev.query !== t.query || prev.from !== t.from;
    setActive(t);
    if (changed) {
      setSelected(0);
      const rect = el.getBoundingClientRect();
      setCoords({ left: rect.left, top: rect.bottom + 4 });
    }
  }, [ref, setActive]);

  // After a programmatic insert, restore focus and drop the caret past "}}".
  useLayoutEffect(() => {
    if (pendingCaret.current == null) return;
    const el = ref.current;
    const pos = pendingCaret.current;
    pendingCaret.current = null;
    if (el) {
      el.focus();
      el.setSelectionRange(pos, pos);
    }
  });

  const choose = useCallback(
    (o: TokenOption) => {
      const el = ref.current;
      const t = triggerRef.current;
      if (!el || !t) return;
      const caret = el.selectionStart ?? el.value.length;
      const insert = `{{${o.token}}}`;
      const next = el.value.slice(0, t.from) + insert + el.value.slice(caret);
      pendingCaret.current = t.from + insert.length;
      dismissed.current = null;
      setActive(null);
      setValue(next);
    },
    [ref, setActive, setValue]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<TextField>): boolean => {
      if (composing.current || e.nativeEvent.isComposing) return false;
      if (!triggerRef.current) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        dismissed.current = triggerRef.current;
        setActive(null);
        return true;
      }
      if (items.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(items[Math.min(selected, items.length - 1)]);
        return true;
      }
      return false;
    },
    [items, selected, choose, setActive]
  );

  const onCompositionStart = useCallback(() => {
    composing.current = true;
  }, []);
  const onCompositionEnd = useCallback(() => {
    composing.current = false;
    sync();
  }, [sync]);

  const menu =
    trigger && coords ? (
      <div
        className="ledgr-token-popup"
        style={{ position: "fixed", left: coords.left, top: coords.top }}
        // Keep focus in the field so the caret/selection survives a click.
        onMouseDown={(e) => e.preventDefault()}
        role="listbox"
      >
        {items.length === 0 ? (
          <div className="ledgr-token-empty">No matching field</div>
        ) : (
          // Grouped by field family, mirroring the TipTap popup markup. `choose`
          // is only referenced from the button's mousedown handler (never during
          // render), so it stays off the render path.
          items.map((it, i) => (
            <Fragment key={it.token}>
              {(i === 0 || items[i - 1].group !== it.group) && (
                <div className="ledgr-token-group">{it.group}</div>
              )}
              <button
                type="button"
                className={"ledgr-token-item" + (i === selected ? " is-selected" : "")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(it);
                }}
              >
                <span className="ledgr-token-item-label">{it.label}</span>
                <span className="ledgr-token-item-hint">{it.hint}</span>
              </button>
            </Fragment>
          ))
        )}
      </div>
    ) : null;

  return {
    menu,
    sync,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    close,
    open: trigger !== null,
  };
}
