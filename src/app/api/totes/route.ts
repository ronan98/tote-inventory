import { endpoint, jsonBody } from "@/lib/http";
import { createTote, listTotes } from "@/lib/inventory";
import { toteInput } from "@/lib/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return endpoint(() => ({ totes: listTotes({ includeArchived: new URL(request.url).searchParams.get("archived") === "1" }) })); }
export function POST(request: Request) { return endpoint(async () => ({ tote: createTote(toteInput.parse(await jsonBody(request))) }), 201); }
