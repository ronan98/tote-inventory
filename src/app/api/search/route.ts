import { endpoint } from "@/lib/http";
import { searchInventory } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return endpoint(() => searchInventory((new URL(request.url).searchParams.get("q") || "").slice(0,200))); }
