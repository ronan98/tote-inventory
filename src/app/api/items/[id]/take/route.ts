import { endpoint, jsonBody } from "@/lib/http";
import { takeItem } from "@/lib/inventory";
import { takeInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => takeItem((await context.params).id, takeInput.parse(await jsonBody(request)))); }
