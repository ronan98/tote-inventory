import { DomainError, getTote, listTotes } from "./inventory";

export type LabelFormat = "avery15264" | "plain";
export type LabelQuery = { ids?: string; format?: string; start?: string };
export type LabelTote = { id: string; code: string; name: string };

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
  const requested = query.ids ? [...new Set(query.ids.split(",").filter(Boolean))] : listTotes().map(tote => tote.id);
  const totes: LabelTote[] = requested.flatMap(id => {
    try { const { id: toteId, code, name } = getTote(id).tote; return [{ id: toteId, code, name }]; }
    catch (error) { if (error instanceof DomainError && error.status === 404) return []; throw error; }
  });
  return { format, start, totes };
}

export function labelSheets<T>(labels: T[], start: number): (T | null)[][] {
  const slots: (T | null)[] = labels.length ? [...Array<null>(start - 1).fill(null), ...labels] : [];
  return Array.from({ length: Math.ceil(slots.length / 6) }, (_, sheet) =>
    Array.from({ length: 6 }, (_, slot) => slots[sheet * 6 + slot] || null));
}
