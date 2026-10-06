import { endpoint, requireSameOrigin } from "@/lib/http";
import { restoreTote } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => { requireSameOrigin(request); return restoreTote((await context.params).id); }); }
