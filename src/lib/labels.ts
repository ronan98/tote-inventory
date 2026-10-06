import { DomainError, getTote, listTotes } from "./inventory";
import type { LabelFormat, LabelTote } from "./label-layout";

export type { LabelFormat, LabelTote } from "./label-layout";
export { labelSheets } from "./label-layout";
export type LabelQuery = { ids?: string; format?: string; start?: string };

// Avery 15264 / U-0091-01, in PDF points (72 points per inch).
export const labelGeometry = {
  pageWidth: 612, pageHeight: 792,
  width: 288, height: 240,
  left: 11.25, top: 36, columnGap: 13.5,
  padding: 18, qrSize: 122.4, quietZone: 4,
} as const;

export function getLabelSelection(query: LabelQuery) {
  const format: LabelFormat = query.format === "plain" ? "plain" : "avery15264";
  const start = format === "avery15264" && /^[1-6]$/.test(query.start || "") ? Number(query.start) : 1;
  const requested = query.ids !== undefined ? [...new Set(query.ids.split(",").filter(Boolean))] : listTotes().map(tote => tote.id);
  const totes: LabelTote[] = requested.flatMap(id => {
    try { const { id: toteId, code, name } = getTote(id).tote; return [{ id: toteId, code, name }]; }
    catch (error) { if (error instanceof DomainError && error.status === 404) return []; throw error; }
  });
  return { format, start, totes };
}

export function getLabelOptions(selected: readonly LabelTote[]): LabelTote[] {
  const active = listTotes().map(({ id, code, name }) => ({ id, code, name }));
  const activeIds = new Set(active.map(tote => tote.id));
  return [...active, ...selected.filter(tote => !activeIds.has(tote.id))];
}
