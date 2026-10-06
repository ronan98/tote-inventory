"use client";
import Link from "next/link";

type LabelFormat = "avery15264" | "plain";

type PrintLabelsProps = {
  count: number;
  format?: LabelFormat;
  start?: number;
};

const labelPositions = [
  "1 — Top left",
  "2 — Top right",
  "3 — Middle left",
  "4 — Middle right",
  "5 — Bottom left",
  "6 — Bottom right",
];

export function PrintLabels({ count, format = "avery15264", start = 1 }: PrintLabelsProps) {
  function changeLayout(nextFormat: LabelFormat, nextStart: number) {
    const url = new URL(window.location.href);
    url.searchParams.set("format", nextFormat);
    url.searchParams.set("start", String(nextFormat === "plain" ? 1 : nextStart));
    window.location.assign(url.toString());
  }

  function openPrintPdf() {
    const url = new URL("/api/labels/pdf", window.location.origin);
    const currentUrl = new URL(window.location.href);
    const ids = currentUrl.searchParams.get("ids");
    if (ids !== null) url.searchParams.set("ids", ids);
    url.searchParams.set("format", format);
    url.searchParams.set("start", String(format === "plain" ? 1 : start));
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  return <div className="label-toolbar">
    <div className="label-toolbar-heading">
      <Link href="/">Back to inventory</Link>
      <p>{count} {count === 1 ? "label" : "labels"} ready.</p>
      <button type="button" disabled={count === 0} onClick={openPrintPdf}>Open print PDF</button>
      <button className="label-web-print" type="button" disabled={count === 0} onClick={() => window.print()}>Print web page</button>
    </div>
    <div className="label-print-controls">
      <div>
        <label className="field-label" htmlFor="label-format">Paper / layout</label>
        <select className="field" id="label-format" value={format} onChange={(event) => changeLayout(event.target.value as LabelFormat, start)}>
          <option value="avery15264">Avery 15264 — 6 labels per sheet</option>
          <option value="plain">Plain paper — cut out labels</option>
        </select>
      </div>
      {format === "avery15264" && <div>
        <label className="field-label" htmlFor="label-start">Start on label</label>
        <select className="field" id="label-start" value={start} aria-describedby="label-start-help" onChange={(event) => changeLayout(format, Number(event.target.value))}>
          {labelPositions.map((position, index) => <option value={index + 1} key={position}>{position}</option>)}
        </select>
        <span className="field-helper" id="label-start-help">For a partly used sheet. Positions run left to right, top to bottom.</span>
      </div>}
    </div>
    <p className="label-print-help">Open the PDF for fixed-size labels. On iPhone, use Share → Print from the PDF. Choose US Letter, portrait, Actual size / 100%, and one page per sheet; turn off Fit to page. For web-page printing, turn off headers and footers. Print a plain-paper test and hold it against a label sheet to check alignment.{format === "plain" && " Cut out the labels along the borders."}</p>
  </div>;
}
