import { endpoint } from "@/lib/http";
import { listActivity } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return endpoint(() => ({ history: listActivity() })); }
