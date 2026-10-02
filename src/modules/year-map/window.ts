// The date window the Year Map needs (ADR-287): the first day of the window's
// first month through the last day of its last, so the view query can load only
// rows whose dates can touch it. Pure, so verify-year-map.mts can assert it.
import type { DateWindow, ViewDefinition } from "@/lib/views";
import { YEAR_MODE, addMonths, daysIn, parseYearSettings, windowLength, windowStart, ymKey, type Ym } from "./lib";

export function yearWindowRange(raw: unknown, anchor: Ym): { start: string; end: string } {
  const s = parseYearSettings(raw);
  const first = windowStart(s, anchor);
  const last = addMonths(first, windowLength(s) - 1);
  return { start: `${ymKey(first)}-01`, end: `${ymKey(last)}-${String(daysIn(last)).padStart(2, "0")}` };
}

export function yearQueryWindow(
  view: Pick<ViewDefinition, "display" | "dateProperty">,
  ctx: { month?: string; today: string }
): DateWindow {
  const ym = /^\d{4}-\d{2}$/.test(ctx.month ?? "") ? ctx.month! : ctx.today.slice(0, 7);
  const w = yearWindowRange(view.display?.modes?.[YEAR_MODE], { y: Number(ym.slice(0, 4)), m: Number(ym.slice(5, 7)) });
  const sf = view.display?.startField;
  const stamp = sf && "field" in sf ? sf.field : view.dateProperty;
  return {
    ...w,
    propKeys: sf && "prop" in sf ? [sf.prop] : undefined,
    stamps: stamp === "createdAt" || stamp === "updatedAt" ? [stamp] : undefined,
  };
}
