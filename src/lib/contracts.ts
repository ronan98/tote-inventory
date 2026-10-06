export interface PhotoDTO { id: string; url: string; thumbUrl: string; createdAt: string }
export interface ToteDTO {
  id: string; code: string; name: string; notes: string; photo: PhotoDTO | null;
  itemCount: number; totalQuantity: number; outstandingQuantity: number;
  createdAt: string; updatedAt: string; contentsUpdatedAt: string; archivedAt: string | null;
}
export interface ItemDTO { id: string; name: string; notes: string; quantity: number; updatedAt: string }
export interface RemovalDTO { id: string; itemId: string; itemName: string; itemNotes: string; toteId: string | null; toteCode: string | null; toteName: string | null; quantity: number; outstandingQuantity: number; createdAt: string }
export interface ActivityDTO { id: string; type: string; description: string; createdAt: string }
export interface ToteDetailDTO { tote: ToteDTO; items: ItemDTO[]; removals: RemovalDTO[]; history: ActivityDTO[] }
export interface SearchResultDTO { itemId: string; name: string; toteId: string; toteCode: string; toteName: string; quantity: number; outstandingQuantity: number; photoThumbUrl: string | null }
export interface SearchDTO { results: SearchResultDTO[]; totes: ToteDTO[] }
export interface PhotoRecordDTO { id: string; toteId: string; originalName: string; mimeType: string; createdAt: string }

export interface AISuggestionDTO { id: string; name: string; quantity: number; note: string }
export interface AIRunDTO {
  id: string; toteId: string; photoId: string; contentsUpdatedAt: string;
  status: "queued" | "running" | "ready" | "failed" | "accepted";
  model: string; suggestions: AISuggestionDTO[]; stale: boolean; error: string | null;
  createdAt: string; acceptedCount: number; queuePosition: number | null;
  dismissed: boolean; dismissedSuggestionIds: string[];
}
export interface AIStateDTO { enabled: boolean; run: AIRunDTO | null }
