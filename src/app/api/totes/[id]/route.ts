import { endpoint, jsonBody, requireSameOrigin } from "@/lib/http";
import { archiveTote, getTote, updateTote } from "@/lib/inventory";
import { toteInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(_request: Request, context: Context) { return endpoint(async () => getTote((await context.params).id)); }
export function PATCH(request: Request, context: Context) { return endpoint(async () => ({ tote: updateTote((await context.params).id, toteInput.parse(await jsonBody(request))) })); }
export function DELETE(request: Request, context: Context) { return endpoint(async () => { requireSameOrigin(request); return archiveTote((await context.params).id); }); }
