import { endpoint, jsonBody } from "@/lib/http";
import { addItems } from "@/lib/inventory";
import { itemBatchInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => addItems((await context.params).id, itemBatchInput.parse(await jsonBody(request))), 201); }
