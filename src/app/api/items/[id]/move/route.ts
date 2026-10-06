import { endpoint, jsonBody } from "@/lib/http";
import { moveItem } from "@/lib/inventory";
import { moveInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => moveItem((await context.params).id, moveInput.parse(await jsonBody(request)))); }
