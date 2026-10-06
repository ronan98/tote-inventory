import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PrintScaling, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { labelGeometry as geometry, labelSheets, type LabelFormat, type LabelTote } from "./labels";

let fontBytes: Promise<[Buffer, Buffer]> | undefined;
function loadFonts() {
  return fontBytes ||= Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf")),
    readFile(path.join(process.cwd(), "public/fonts/NotoSans-Bold.ttf")),
  ]);
}

function printable(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].map(character => supported.has(character.codePointAt(0)!) ? character : "?").join("");
}

function wrapName(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width) {
      line = line ? `${line} ${word}` : word;
      continue;
    }
    if (line) { lines.push(line); line = ""; }
    for (const character of word) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderLabelPdf(totes: LabelTote[], origin: string, format: LabelFormat, start: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  pdf.setTitle("Home Inventory - Avery 15264 labels");
  pdf.setCreator("Home Inventory");
  const preferences = pdf.catalog.getOrCreateViewerPreferences();
  preferences.setPrintScaling(PrintScaling.None);
  preferences.setPickTrayByPDFSize(true);

  for (const sheet of labelSheets(totes, start)) {
    const page = pdf.addPage([geometry.pageWidth, geometry.pageHeight]);
    for (const [slot, tote] of sheet.entries()) {
      if (!tote) continue;
      const left = geometry.left + (slot % 2) * (geometry.width + geometry.columnGap);
      const top = geometry.top + Math.floor(slot / 2) * geometry.height;
      const bottom = geometry.pageHeight - top - geometry.height;
      if (format === "plain") page.drawRectangle({ x: left, y: bottom, width: geometry.width, height: geometry.height, borderWidth: .4, borderColor: rgb(.7, .7, .7), borderDashArray: [3, 3] });

      // Place each QR at the label's centre, independently of text or footer height.
      const qrLeft = left + geometry.width - geometry.padding - geometry.qrSize;
      const qrBottom = bottom + (geometry.height - geometry.qrSize) / 2;
      const matrix = QRCode.create(origin + "/totes/" + tote.id, { errorCorrectionLevel: "M" }).modules;
      const moduleSize = geometry.qrSize / (matrix.size + 2 * geometry.quietZone);
      for (let row = 0; row < matrix.size; row++) {
        for (let column = 0; column < matrix.size; column++) {
          if (!matrix.get(row, column)) continue;
          page.drawRectangle({
            x: qrLeft + (column + geometry.quietZone) * moduleSize,
            y: qrBottom + (matrix.size + geometry.quietZone - row - 1) * moduleSize,
            width: moduleSize, height: moduleSize, color: rgb(0, 0, 0),
          });
        }
      }

      const textLeft = left + geometry.padding;
      const textWidth = qrLeft - textLeft - 8.64;
      const name = printable(tote.name, bold);
      let nameSize = tote.name.length > 90 ? 14 : tote.name.length > 60 ? 18 : 20;
      let lines = wrapName(name, bold, nameSize, textWidth);
      while (lines.length > 5 && nameSize > 12) { nameSize--; lines = wrapName(name, bold, nameSize, textWidth); }
      if (lines.length > 5) {
        lines = lines.slice(0, 5);
        let last = lines[4];
        while (bold.widthOfTextAtSize(last + "...", nameSize) > textWidth) last = last.slice(0, -1);
        lines[4] = last + "...";
      }
      const lineHeight = nameSize * 1.15;
      const textHeight = 11.2 + 7.2 + lines.length * lineHeight + 8.64 + 13;
      let cursor = bottom + (geometry.height + textHeight) / 2;
      page.drawText("HOME INVENTORY", { x: textLeft, y: cursor - 8, size: 8, font: regular });
      cursor -= 11.2 + 7.2;
      for (const line of lines) {
        page.drawText(line, { x: textLeft, y: cursor - nameSize, size: nameSize, font: bold });
        cursor -= lineHeight;
      }
      cursor -= 8.64;
      page.drawText(tote.code, { x: textLeft, y: cursor - 10, size: 10, font: bold, color: rgb(.27, .27, .27) });
      const address = printable(new URL(origin).host, regular);
      const addressWidth = regular.widthOfTextAtSize(address, 8);
      page.drawText(address, { x: left + (geometry.width - addressWidth) / 2, y: bottom + geometry.padding, size: 8, font: regular });
    }
  }
  return pdf.save();
}
