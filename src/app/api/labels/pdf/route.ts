import { appOrigin, endpoint } from "@/lib/http";
import { DomainError } from "@/lib/inventory";
import { getLabelSelection } from "@/lib/labels";
import { renderLabelPdf } from "@/lib/label-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return endpoint(async () => {
    const query = new URL(request.url).searchParams;
    const { totes, format, start } = getLabelSelection({
      ids: query.get("ids") ?? undefined, format: query.get("format") || undefined, start: query.get("start") || undefined,
    });
    if (!totes.length) throw new DomainError(400, "Choose at least one existing tote before printing labels.");
    const pdf = await renderLabelPdf(totes, appOrigin(), format, start);
    return new Response(Buffer.from(pdf), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="inventory-avery-15264-labels.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
