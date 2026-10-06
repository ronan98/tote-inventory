import { endpoint, jsonBody, requireSameOrigin } from "@/lib/http";
import { deleteItem, updateItem } from "@/lib/inventory";
import { itemEditInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => updateItem((await context.params).id, itemEditInput.parse(await jsonBody(request)))); }
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => { requireSameOrigin(request); return deleteItem((await context.params).id); }); }
