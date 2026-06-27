// Selection cells for the table layout (ADR-118). The list/agenda layouts use a
// flex row, where an off-mode SelectCheckbox (null) simply takes no space — but
// a table column can't collapse from a null cell alone, so these wrap the
// header/body cells and self-gate on select mode. ViewRenderer is a server
// component and can't read the client select-mode context, so the gating has to
// live in these client cells. Header and every body row gate on the same flag,
// so the column count always stays consistent.
"use client";

import SelectCheckbox from "@/components/selection/SelectCheckbox";
import { useSelectionOptional } from "@/components/selection/SelectionProvider";

export function SelectHeaderCell() {
  const selection = useSelectionOptional();
  if (!selection?.selectMode) return null;
  return <th className="w-6 py-1.5 pr-2" aria-hidden />;
}

export function SelectBodyCell({ id }: { id: string }) {
  const selection = useSelectionOptional();
  if (!selection?.selectMode) return null;
  return (
    <td className="py-1.5 pr-2 align-middle">
      <SelectCheckbox id={id} />
    </td>
  );
}
