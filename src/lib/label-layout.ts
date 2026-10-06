export type LabelFormat = "avery15264" | "plain";
export type LabelTote = { id: string; code: string; name: string };

export function labelSheets<T>(labels: readonly T[], start: number): (T | null)[][] {
  const slots: (T | null)[] = labels.length ? [...Array<null>(start - 1).fill(null), ...labels] : [];
  return Array.from({ length: Math.ceil(slots.length / 6) }, (_, sheet) =>
    Array.from({ length: 6 }, (_, slot) => slots[sheet * 6 + slot] || null));
}

/** An explicit empty selection must never fall back to printing every tote. */
export function buildLabelURL(path: string, ids: readonly string[], format: LabelFormat, start: number): string {
  const query = new URLSearchParams({ ids: [...new Set(ids)].join(","), format, start: String(format === "plain" ? 1 : start) });
  return `${path}?${query}`;
}
