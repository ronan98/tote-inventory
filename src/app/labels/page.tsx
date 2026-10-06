import QRCode from "qrcode";
import { appOrigin } from "@/lib/http";
import { getLabelSelection, labelSheets } from "@/lib/labels";
import { PrintLabels } from "@/components/PrintLabels";
import "./labels.css";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Labels({ searchParams }: { searchParams: Promise<{ ids?: string; format?: string; start?: string }> }) {
  const { totes, format, start } = getLabelSelection(await searchParams);
  const origin = appOrigin();
  const address = new URL(origin).host;
  const labels = await Promise.all(totes.map(async tote => ({ tote, qr: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(await QRCode.toString(origin + "/totes/" + tote.id, { type: "svg", errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } })) })));
  const sheets = labelSheets(labels, start);
  return <main className="labels-page" data-label-format={format}>
    <PrintLabels count={labels.length} format={format} start={start}/>
    {labels.length === 0 && <p className="label-empty">Create a tote before printing labels.</p>}
    {sheets.map((sheet, sheetIndex) => <section className="label-sheet-group" key={sheetIndex} aria-label={`Label sheet ${sheetIndex + 1}`}>
      <p className="sheet-caption">Sheet {sheetIndex + 1} of {sheets.length}{format === "avery15264" ? " · Avery 15264" : " · Plain paper"}</p>
      <div className="label-sheet">
        {sheet.map((label, slotIndex) => label ? <article className="tote-label" key={label.tote.id} data-label-slot={slotIndex + 1}>
          <div className="label-text"><span className="label-brand">HOME INVENTORY</span><h1 className={"label-name" + (label.tote.name.length > 90 ? " label-name-small" : label.tote.name.length > 60 ? " label-name-medium" : "")}>{label.tote.name}</h1><p className="label-code">{label.tote.code}</p></div>
          <img src={label.qr} width={190} height={190} alt={`QR code for ${label.tote.name} (${label.tote.code})`}/>
          <span className="label-address">{address}</span>
        </article> : <div className="tote-label label-empty-slot" key={`blank-${slotIndex}`} data-label-slot={slotIndex + 1} aria-hidden="true"><span>{sheetIndex === 0 && slotIndex < start - 1 ? "Skipped label" : "Unused label"}</span></div>)}
      </div>
    </section>)}
  </main>;
}
