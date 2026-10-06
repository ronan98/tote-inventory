import { ZodError } from "zod";
import { DomainError } from "./inventory";
import { resolveAppOrigin } from "./config";

export async function endpoint(work: () => unknown | Promise<unknown>, status = 200): Promise<Response> {
  try {
    const result = await work();
    if (result instanceof Response) return result;
    return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message || "Check the information and try again." }, { status: 400 });
    console.error("Inventory request failed", error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
export function appOrigin(): string {
  return resolveAppOrigin();
}
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const allowed = appOrigin();
  const developmentOrigin = process.env.NODE_ENV !== "production" && new URL(request.url).origin;
  if (!origin || (origin !== allowed && origin !== developmentOrigin)) {
    throw new DomainError(403, "Open this action from the inventory site.");
  }
}
export async function limitedBody(request: Request, limit: number): Promise<Buffer> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw new DomainError(413, "This upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > limit) { await reader.cancel(); throw new DomainError(413, "This upload is too large."); }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
export async function jsonBody(request: Request): Promise<unknown> {
  requireSameOrigin(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new DomainError(415, "Send this action as JSON.");
  }
  const bytes = await limitedBody(request, 64 * 1024);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new DomainError(400, "The request could not be read."); }
}
