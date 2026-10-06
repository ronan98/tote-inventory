import QRCode from "qrcode";
import { appOrigin, endpoint } from "@/lib/http";
import { getTote } from "@/lib/inventory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return endpoint(async () => {
  const { tote } = getTote((await context.params).id);
  const svg = await QRCode.toString(appOrigin() + "/totes/" + tote.id, { type: "svg", errorCorrectionLevel: "M", margin: 3, width: 512, color: { dark: "#172a21", light: "#ffffff" } });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": 'inline; filename="' + tote.code + '.svg"', "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}); }
