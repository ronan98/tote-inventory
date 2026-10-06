import { appOrigin, endpoint } from "@/lib/http";
import { getDatabase } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return endpoint(() => { appOrigin(); getDatabase().prepare("SELECT 1").get(); return { status: "ready", stage: "inventory", appReady: true }; }); }
