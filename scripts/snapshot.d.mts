export function copyInventorySnapshot(dataDirectory: string, targetDirectory: string, minimumFreeBytes?: number): Promise<{
  schemaVersion: number;
  photos: { path: string; bytes: number }[];
}>;
