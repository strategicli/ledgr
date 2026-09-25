// Right-click on an inline item reference (a mention chip in the editor, an item
// link in the preview) opens a module's menu at the cursor. Core owns only this
// hand-off: the editor asks "is anyone listening?" and, if so, passes the click
// along. A module registers a listener from a shell panel it mounts only while
// it is on (the Desk's "Send to Desk" menu today, ADR-146 S3b; ADR-272 step 4).
// With no listener the editor leaves the browser's native context menu alone,
// so a switched-off module leaves no trace in the editor.
export type InlineRefMenuDetail = {
  itemId: string;
  // The item being read, when the reference sits inside one.
  currentItemId?: string;
  x: number;
  y: number;
};

type Listener = {
  // Whether this listener would open a menu right now (e.g. desktop only).
  available: () => boolean;
  open: (detail: InlineRefMenuDetail) => void;
};

const listeners = new Set<Listener>();

export function inlineRefMenuAvailable(): boolean {
  for (const l of listeners) if (l.available()) return true;
  return false;
}

export function openInlineRefMenu(detail: InlineRefMenuDetail): void {
  for (const l of listeners) if (l.available()) l.open(detail);
}

// Returns the unsubscribe, for a useEffect cleanup.
export function listenInlineRefMenu(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
