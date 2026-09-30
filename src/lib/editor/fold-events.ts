// The window event the item's ⋯ menu fires for "Expand all": every editor
// showing that item opens its collapsed headings and list items. Lives here,
// not in collapsible-headings.ts, so the menu doesn't pull the editor bundle.
export const EXPAND_ALL_EVENT = "ledgr:expand-all-folds";
