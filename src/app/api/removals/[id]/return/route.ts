import { endpoint, jsonBody } from "@/lib/http";
import { returnItem } from "@/lib/inventory";
import { returnInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => returnItem((await context.params).id, returnInput.parse(await jsonBody(request)))); }
