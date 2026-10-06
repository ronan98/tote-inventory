import QRCode from "qrcode";
import { appOrigin } from "@/lib/http";
import { getLabelOptions, getLabelSelection } from "@/lib/labels";
import { PrintLabels } from "@/components/PrintLabels";
import "./labels.css";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Labels({ searchParams }: { searchParams: Promise<{ ids?: string; format?: string; start?: string }> }) {
  const { totes, format, start } = getLabelSelection(await searchParams);
  const origin = appOrigin();
  const address = new URL(origin).host;
  const options = await Promise.all(getLabelOptions(totes).map(async tote => ({ tote, qr: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(await QRCode.toString(origin + "/totes/" + tote.id, { type: "svg", errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } })) })));
  return <PrintLabels options={options} selectedIds={totes.map(tote => tote.id)} address={address} format={format} start={start}/>;
}
