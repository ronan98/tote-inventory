import { z } from "zod";
import { endpoint, jsonBody } from "@/lib/http";
import { createAIRun, getAIState } from "@/lib/ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export function GET(_request: Request, context: Context) {
  return endpoint(async () => getAIState(z.string().uuid().parse((await context.params).id)));
}
export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const id = z.string().uuid().parse((await context.params).id);
    return createAIRun(id, await jsonBody(request)).state;
  }, 202);
}
