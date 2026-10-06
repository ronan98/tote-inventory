import { endpoint } from "@/lib/http";
import { servePhoto } from "@/lib/photos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => servePhoto((await context.params).id, new URL(request.url).searchParams.get("size"))); }
