import { endpoint } from "@/lib/http";
import { exportInventory } from "@/lib/export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return endpoint(() => exportInventory(new URL(request.url).searchParams.get("format"))); }
