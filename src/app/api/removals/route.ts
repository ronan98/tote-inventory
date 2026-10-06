import { endpoint } from "@/lib/http";
import { listRemovals } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return endpoint(() => ({ removals: listRemovals() })); }
