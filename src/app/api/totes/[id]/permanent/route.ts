import { endpoint, requireSameOrigin } from "@/lib/http";
import { deleteTote } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => { requireSameOrigin(request); return deleteTote((await context.params).id); }); }
