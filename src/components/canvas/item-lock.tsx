// The item lock (ADR-097), carried by context so every canvas honors it.
// ItemCanvas wraps whatever canvas a type uses in <ItemLockProvider>, so the
// editors (title, body) read the lock here instead of each bespoke canvas
// having to remember to thread a `locked` prop down. The prop-only design let
// the task, notes-tab, mind map, chord and paper canvases stay editable while
// locked; reading it from the shared frame closes that for every canvas,
// including ones added later.
"use client";

import { createContext, useContext } from "react";

const ItemLockContext = createContext(false);

export function ItemLockProvider({
  locked,
  children,
}: {
  locked: boolean;
  children: React.ReactNode;
}) {
  return <ItemLockContext.Provider value={locked}>{children}</ItemLockContext.Provider>;
}

export function useItemLocked(): boolean {
  return useContext(ItemLockContext);
}
