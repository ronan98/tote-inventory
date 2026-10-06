"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { buildLabelURL, labelSheets, type LabelFormat, type LabelTote } from "@/lib/label-layout";

type LabelOption = { tote: LabelTote; qr: string };
type PrintLabelsProps = {
  options: LabelOption[];
  selectedIds: string[];
  address: string;
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

export function PrintLabels({ options, selectedIds: initialIds, address, format: initialFormat = "avery15264", start: initialStart = 1 }: PrintLabelsProps) {
  const queryString = useSearchParams().toString();
  const [selectedIds, setSelectedIds] = useState(initialIds);
  const [format, setFormat] = useState(initialFormat);
  const [start, setStart] = useState(initialStart);
  const selected = new Set(selectedIds);
  const labels = options.filter(option => selected.has(option.tote.id));
  const ids = labels.map(label => label.tote.id);
  const sheets = labelSheets(labels, start);
  const count = labels.length;

  // Native history updates and Back/Forward stay in sync even when Next.js restores cached page props.
  useEffect(() => {
    const query = new URLSearchParams(queryString);
    const nextFormat: LabelFormat = query.get("format") === "plain" ? "plain" : "avery15264";
    const nextStart = nextFormat === "avery15264" && /^[1-6]$/.test(query.get("start") || "") ? Number(query.get("start")) : 1;
    const requested = query.has("ids") ? new Set((query.get("ids") || "").split(",")) : new Set(options.map(option => option.tote.id));
    setSelectedIds(options.filter(option => requested.has(option.tote.id)).map(option => option.tote.id));
    setFormat(nextFormat);
    setStart(nextStart);
  }, [queryString, options]);

  function updateSelection(nextIds: string[], nextFormat = format, nextStart = start) {
    const effectiveStart = nextFormat === "plain" ? 1 : nextStart;
    setSelectedIds(nextIds);
    setFormat(nextFormat);
    setStart(effectiveStart);
    // Keep reloads and shared links in sync without navigating or reloading on each tap.
    window.history.replaceState(null, "", buildLabelURL(window.location.pathname, nextIds, nextFormat, effectiveStart) + window.location.hash);
  }

  function toggleTote(id: string, checked: boolean) {
    const nextSelected = new Set(selectedIds);
    if (checked) nextSelected.add(id); else nextSelected.delete(id);
    updateSelection(options.filter(option => nextSelected.has(option.tote.id)).map(option => option.tote.id));
  }

  function openPrintPdf() {
    window.open(buildLabelURL("/api/labels/pdf", ids, format, start), "_blank", "noopener,noreferrer");
  }

  return <main className="labels-page" data-label-format={format}>
  <div className="label-toolbar">
    <div className="label-toolbar-heading">
      <Link href="/">Back to inventory</Link>
      <p role="status" aria-live="polite" aria-atomic="true">{count} of {options.length} {options.length === 1 ? "tote" : "totes"} selected.</p>
      <button type="button" disabled={count === 0} onClick={openPrintPdf}>Open print PDF</button>
      <button className="label-web-print" type="button" disabled={count === 0} onClick={() => window.print()}>Print web page</button>
    </div>
    {options.length > 0 && <fieldset className="label-tote-picker">
      <legend>Select totes to print</legend>
      <div className="label-selection-heading">
        <p>Only checked totes will appear in the preview and printout.</p>
        <div className="label-selection-actions">
          <button type="button" disabled={count === options.length} onClick={() => updateSelection(options.map(option => option.tote.id))}>Select all</button>
          <button type="button" disabled={count === 0} onClick={() => updateSelection([])}>Clear selection</button>
        </div>
      </div>
      <div className="label-tote-options">
        {options.map(option => <label className="label-tote-option" key={option.tote.id} data-selected={selected.has(option.tote.id)}>
          <input type="checkbox" checked={selected.has(option.tote.id)} onChange={event => toggleTote(option.tote.id, event.target.checked)}/>
          <span><strong>{option.tote.name}</strong><span className="label-option-code">{option.tote.code}</span></span>
        </label>)}
      </div>
    </fieldset>}
    <div className="label-print-controls">
      <div>
        <label className="field-label" htmlFor="label-format">Paper / layout</label>
        <select className="field" id="label-format" value={format} onChange={event => updateSelection(ids, event.target.value as LabelFormat, start)}>
          <option value="avery15264">Avery 15264 — 6 labels per sheet</option>
          <option value="plain">Plain paper — cut out labels</option>
        </select>
      </div>
      {format === "avery15264" && <div>
        <label className="field-label" htmlFor="label-start">Start on label</label>
        <select className="field" id="label-start" value={start} aria-describedby="label-start-help" onChange={event => updateSelection(ids, format, Number(event.target.value))}>
          {labelPositions.map((position, index) => <option value={index + 1} key={position}>{position}</option>)}
        </select>
        <span className="field-helper" id="label-start-help">For a partly used sheet. Positions run left to right, top to bottom.</span>
      </div>}
    </div>
    <p className="label-print-help">Open the PDF for fixed-size labels. On iPhone, use Share → Print from the PDF. Choose US Letter, portrait, Actual size / 100%, and one page per sheet; turn off Fit to page. For web-page printing, turn off headers and footers. Print a plain-paper test and hold it against a label sheet to check alignment.{format === "plain" && " Cut out the labels along the borders."}</p>
  </div>
  {count === 0 && <p className="label-empty">{options.length === 0 ? "Create a tote before printing labels." : "Select at least one tote to preview and print its label."}</p>}
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
