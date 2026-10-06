import { z } from "zod";
import { endpoint, jsonBody } from "@/lib/http";
import { dismissAISuggestions } from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => dismissAISuggestions(z.string().uuid().parse((await context.params).id), await jsonBody(request)));
}
