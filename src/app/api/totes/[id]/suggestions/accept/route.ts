import { z } from "zod";
import { endpoint, jsonBody } from "@/lib/http";
import { acceptAISuggestions } from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return endpoint(async () => acceptAISuggestions(z.string().uuid().parse((await context.params).id), await jsonBody(request)));
}
