import { PDFDocument, StandardFonts, degrees, rgb } from "./vendor/pdf-lib/pdf-lib.esm.min.js";
import * as XLSX from "./vendor/xlsx/xlsx.mjs";

export function parsePageSelection(input, pageCount) {
  const value = String(input || "").trim();
  if (!value) throw new Error("Enter at least one page number.");
  const selected = [];
  for (const token of value.split(",")) {
    const part = token.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) throw new Error(`Page range ${part} is backwards.`);
      if (start < 1 || end > pageCount) {
        const invalid = start < 1 ? start : end;
        throw new Error(`Page ${invalid} is outside this ${pageCount}-page PDF.`);
      }
      for (let page = start; page <= end; page += 1) selected.push(page);
      continue;
    }
    if (!/^\d+$/.test(part)) throw new Error(`“${part}” is not a valid page number.`);
    selected.push(Number(part));
  }
  if (!selected.length) throw new Error("Enter at least one page number.");
  const invalid = selected.find((page) => page < 1 || page > pageCount);
  if (invalid) throw new Error(`Page ${invalid} is outside this ${pageCount}-page PDF.`);
  return [...new Set(selected)].map((page) => page - 1);
}

export function safePdfName(name, suffix = "edited") {
  const base = String(name || "document.pdf").replace(/\.pdf$/i, "");
  return `${base}-${suffix}.pdf`;
}

export function moveItem(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) throw new Error("Items must be provided as a list.");
  const reordered = [...items];
  if (![fromIndex, toIndex].every(Number.isInteger)) return reordered;
  if (fromIndex < 0 || fromIndex >= reordered.length || toIndex < 0 || toIndex >= reordered.length || fromIndex === toIndex) return reordered;
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

export function parseHexColor(value) {
  const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) throw new Error("Choose a valid watermark color.");
  return {
    red: Number.parseInt(match[1].slice(0, 2), 16) / 255,
    green: Number.parseInt(match[1].slice(2, 4), 16) / 255,
    blue: Number.parseInt(match[1].slice(4, 6), 16) / 255,
  };
}

export function calculateWatermarkPlacement(pageWidth, pageHeight, textWidth, textHeight, position = "center", angleDegrees = 35) {
  const angle = angleDegrees * Math.PI / 180;
  const boundingWidth = textWidth * Math.cos(angle) + textHeight * Math.sin(angle);
  const boundingHeight = textWidth * Math.sin(angle) + textHeight * Math.cos(angle);
  const margin = Math.min(30, pageHeight * 0.05);
  const x = (pageWidth - boundingWidth) / 2 + textHeight * Math.sin(angle);
  const y = position === "top"
    ? pageHeight - boundingHeight - margin
    : position === "bottom"
      ? margin
      : (pageHeight - boundingHeight) / 2;
  return { x, y, boundingWidth, boundingHeight };
}

export function fitImageWithinPage(imageWidth, imageHeight, pageWidth, pageHeight, preferredWidth = 150, margin = 30, maxHeightRatio = 1) {
  if (![imageWidth, imageHeight, pageWidth, pageHeight].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("The signature image or PDF page has invalid dimensions.");
  }
  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const normalizedHeightRatio = Number.isFinite(Number(maxHeightRatio)) ? Math.max(0.1, Math.min(1, Number(maxHeightRatio))) : 1;
  const availableHeight = Math.max(1, Math.min(pageHeight - margin * 2, pageHeight * normalizedHeightRatio));
  const requestedWidth = Math.max(1, Math.min(Number(preferredWidth) || 150, 260));
  const scale = Math.min(requestedWidth / imageWidth, availableWidth / imageWidth, availableHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

export function signatureWidthForPage(pageWidth, requestedScale = 0.26) {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) throw new Error("The PDF page has an invalid width.");
  const numericScale = Number(requestedScale);
  const scale = Number.isFinite(numericScale) ? Math.max(0.12, Math.min(0.4, numericScale)) : 0.26;
  return Math.min(pageWidth * scale, 260);
}

export async function buildPdfFromPages(sources, pageItems) {
  const output = await PDFDocument.create();
  for (const item of pageItems) {
    const source = sources[item.sourceIndex].document;
    const [page] = await output.copyPages(source, [item.pageIndex]);
    page.setRotation(degrees(((item.rotation || 0) % 360 + 360) % 360));
    output.addPage(page);
  }
  return output.save();
}

export async function createSplitPdfs(sourceDocument, indices) {
  const outputs = [];
  for (const index of indices) {
    const document = await PDFDocument.create();
    const [page] = await document.copyPages(sourceDocument, [index]);
    document.addPage(page);
    outputs.push(await document.save());
  }
  return outputs;
}

function textPosition(page, textWidth, textHeight, position, margin) {
  const { width, height } = page.getSize();
  const x = position.includes("left") ? margin : position.includes("right") ? width - textWidth - margin : (width - textWidth) / 2;
  const y = position.startsWith("top") ? height - textHeight - margin : margin;
  return { x, y };
}

export async function stampPdf(bytes, options) {
  const document = await PDFDocument.load(bytes);
  const pages = document.getPages();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const size = Number(options.fontSize || 12);
  const color = rgb(0.31, 0.34, 0.42);

  if (options.kind === "numbers") {
    pages.forEach((page, index) => {
      const text = String(index + Number(options.startAt || 1));
      const width = font.widthOfTextAtSize(text, size);
      const { x, y } = textPosition(page, width, size, options.position || "bottom-center", 24);
      page.drawText(text, { x, y, size, font, color, opacity: 0.9 });
    });
  }

  if (options.kind === "watermark") {
    const text = String(options.text || "DRAFT").trim();
    if (!text) throw new Error("Enter watermark text.");
    const watermarkColor = parseHexColor(options.color || "#547040");
    pages.forEach((page) => {
      const { width, height } = page.getSize();
      const position = ["top", "center", "bottom", "full"].includes(options.position) ? options.position : "center";
      const requestedSize = Number(options.fontSize || 54);
      const unitTextWidth = font.widthOfTextAtSize(text, 1);
      const angle = 35;
      const angleRadians = angle * Math.PI / 180;
      const unitBoundingWidth = unitTextWidth * Math.cos(angleRadians) + Math.sin(angleRadians);
      const unitBoundingHeight = unitTextWidth * Math.sin(angleRadians) + Math.cos(angleRadians);
      const watermarkSize = Math.max(16, Math.min(requestedSize, width * 0.88 / unitBoundingWidth, height * 0.42 / unitBoundingHeight));
      const textWidth = font.widthOfTextAtSize(text, watermarkSize);
      const drawOptions = { size: watermarkSize, font, color: rgb(watermarkColor.red, watermarkColor.green, watermarkColor.blue), opacity: Number(options.opacity || 0.18), rotate: degrees(angle) };

      if (position === "full") {
        const patternSize = Math.max(16, Math.min(watermarkSize * 0.62, 34));
        const patternWidth = font.widthOfTextAtSize(text, patternSize);
        const rowStep = Math.max(patternSize * 3.6, height / 5);
        const columnStep = Math.max(patternWidth + 70, width * 0.58);
        let row = 0;
        for (let y = -patternSize; y < height + rowStep; y += rowStep) {
          const offset = row % 2 === 0 ? -patternWidth * 0.35 : width * 0.08;
          for (let x = offset; x < width + patternWidth; x += columnStep) page.drawText(text, { ...drawOptions, x, y, size: patternSize });
          row += 1;
        }
      } else {
        const placement = calculateWatermarkPlacement(width, height, textWidth, watermarkSize, position, angle);
        page.drawText(text, { ...drawOptions, x: placement.x, y: placement.y });
      }
    });
  }

  if (options.kind === "signature") {
    if (!options.imageBytes) throw new Error("Choose a PNG or JPG signature image.");
    const image = options.imageType === "image/png"
      ? await document.embedPng(options.imageBytes)
      : await document.embedJpg(options.imageBytes);
    const targetPages = options.allPages ? pages : [pages[Math.max(0, Number(options.page || 1) - 1)]].filter(Boolean);
    if (!targetPages.length) throw new Error("The selected signature page does not exist.");
    targetPages.forEach((page) => {
      const { width, height } = page.getSize();
      const preferredWidth = options.signatureWidth || signatureWidthForPage(width, options.signatureScale);
      const fitted = fitImageWithinPage(image.width, image.height, width, height, preferredWidth, 30, 0.34);
      const targetWidth = fitted.width;
      const targetHeight = fitted.height;
      const { x, y } = textPosition(page, targetWidth, targetHeight, options.position || "bottom-right", 30);
      page.drawImage(image, { x, y, width: targetWidth, height: targetHeight, opacity: Number(options.opacity || 1) });
    });
  }

  return document.save();
}

const OFFICE_FONT_SIZE = 11;
const OFFICE_LINE_HEIGHT = 15;
const OFFICE_MARGIN = 44;
const OFFICE_PAGE_WIDTH = 595.28;
const OFFICE_PAGE_HEIGHT = 841.89;

function addOfficePage(pdfDoc) {
  const page = pdfDoc.addPage([OFFICE_PAGE_WIDTH, OFFICE_PAGE_HEIGHT]);
  return { page, y: OFFICE_PAGE_HEIGHT - OFFICE_MARGIN };
}

function wrapAndDraw(pdfDoc, font, paragraphs, title, baseSize) {
  const maxWidth = OFFICE_PAGE_WIDTH - OFFICE_MARGIN * 2;
  let { page, y } = addOfficePage(pdfDoc);

  for (const block of paragraphs) {
    const size = block.bold ? baseSize + 3 : baseSize;
    let prefix = block.prefix || "";
    const indent = block.indent || 0;
    const words = block.text.split(" ");
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const textWidth = font.widthOfTextAtSize(prefix + test, size);
      if (textWidth > maxWidth - indent && current) {
        if (y < OFFICE_MARGIN + 10) {
          const next = addOfficePage(pdfDoc);
          page = next.page;
          y = next.y;
        }
        page.drawText(prefix + current, { x: OFFICE_MARGIN + indent, y, size, font, color: rgb(0, 0, 0) });
        y -= size * 1.45;
        current = word;
        prefix = "";
      } else {
        current = test;
      }
    }
    if (current) {
      if (y < OFFICE_MARGIN + 10) {
        const next = addOfficePage(pdfDoc);
        page = next.page;
        y = next.y;
      }
      page.drawText(prefix + current, { x: OFFICE_MARGIN + indent, y, size, font, color: rgb(0, 0, 0) });
      y -= size * 1.45;
    }
    y -= block.spacing || 4;
  }
}

export async function convertDocxToPdfPages(arrayBuffer, pdfDoc) {
  const mammothLib = globalThis.mammoth;
  if (!mammothLib) throw new Error("mammoth library is not available.");
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const result = await mammothLib.convertToHtml({ arrayBuffer });
  const html = (result.value || "").trim();
  if (!html) throw new Error("The document appears to be empty or contains no extractable text.");
  const paragraphs = [];
  const tagRegex = /<(h[1-6]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>|<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = (match[1] || "li").toLowerCase();
    const content = (match[2] || match[3] || "").replace(/<[^>]+>/g, "").trim();
    if (!content) continue;
    if (tag === "li") {
      paragraphs.push({ text: content, prefix: "• ", indent: 14, bold: false, spacing: 3 });
    } else if (tag === "blockquote") {
      paragraphs.push({ text: content, prefix: "", indent: 20, bold: false, spacing: 5 });
    } else if (tag.match(/^h[1-6]$/)) {
      const level = Number(tag[1]);
      paragraphs.push({ text: content, prefix: "", indent: 0, bold: true, spacing: level <= 2 ? 10 : 6 });
    } else {
      paragraphs.push({ text: content, prefix: "", indent: 0, bold: false, spacing: 5 });
    }
  }
  if (!paragraphs.length) {
    const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) paragraphs.push({ text, prefix: "", indent: 0, bold: false, spacing: 5 });
  }
  if (!paragraphs.length) throw new Error("The document appears to be empty or contains no extractable text.");
  wrapAndDraw(pdfDoc, font, paragraphs, null, OFFICE_FONT_SIZE);
}

export async function convertXlsxToPdfPages(arrayBuffer, pdfDoc) {
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The spreadsheet contains no sheets.");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
  if (!rows.length) throw new Error("The spreadsheet contains no data.");
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const paragraphs = [];
  let headerRow = true;
  for (const row of rows) {
    const cells = Array.isArray(row) ? row.filter((c) => c != null).map(String) : [String(row)];
    const text = cells.join("  |  ") || "";
    if (text) {
      paragraphs.push({ text, prefix: "", indent: 0, bold: headerRow, spacing: 4 });
      headerRow = false;
    }
  }
  wrapAndDraw(pdfDoc, font, paragraphs, null, OFFICE_FONT_SIZE);
}

export async function convertPptxToPdfPages(arrayBuffer, pdfDoc) {
  const JSZipLib = globalThis.JSZip;
  if (!JSZipLib) throw new Error("JSZip library is not available.");
  const zip = await JSZipLib.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();
  if (!slideFiles.length) throw new Error("The presentation contains no slides.");
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (const slidePath of slideFiles) {
    const slideNum = slidePath.match(/\d+/)[0];
    const xml = await zip.files[slidePath].async("text");
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)).map((m) => m[1]);
    const paragraphs = [{ text: `Slide ${slideNum}`, prefix: "", indent: 0, bold: true, spacing: 10 }];
    for (const t of texts) {
      if (t.trim()) paragraphs.push({ text: t.trim(), prefix: "", indent: 14, bold: false, spacing: 4 });
    }
    wrapAndDraw(pdfDoc, font, paragraphs, null, OFFICE_FONT_SIZE);
  }
}

export async function buildMixedPdf(imageItems) {
  const output = await PDFDocument.create();
  for (const item of imageItems) {
    const type = item.file.type || "";
    const ext = item.file.name.split(".").pop().toLowerCase();
    if (type.startsWith("image/") || ["png", "jpg", "jpeg"].includes(ext)) {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const image = type === "image/png" || ext === "png" ? await output.embedPng(bytes) : await output.embedJpg(bytes);
      const preset = "image";
      const margin = 0;
      const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
      const pageWidth = image.width * scale + margin * 2;
      const pageHeight = image.height * scale + margin * 2;
      const page = output.addPage([pageWidth, pageHeight]);
      const drawScale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
      const width = image.width * drawScale;
      const height = image.height * drawScale;
      page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
    } else if (ext === "docx") {
      await convertDocxToPdfPages(await item.file.arrayBuffer(), output, item.file.name);
    } else if (ext === "xlsx") {
      await convertXlsxToPdfPages(await item.file.arrayBuffer(), output, item.file.name);
    } else if (ext === "pptx") {
      await convertPptxToPdfPages(await item.file.arrayBuffer(), output, item.file.name);
    }
  }
  return output.save();
}
