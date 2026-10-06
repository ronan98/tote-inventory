import { endpoint } from "@/lib/http";
import { uploadPhoto } from "@/lib/photos";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => uploadPhoto((await context.params).id, request)); }
