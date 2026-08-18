import { PDFDocument, StandardFonts, degrees, rgb } from "./vendor/pdf-lib/pdf-lib.esm.min.js";
import * as XLSX from "./vendor/xlsx/xlsx.mjs";
import html2canvas from "./vendor/html2canvas/html2canvas.esm.js";

/** Standard paper sizes in PDF points (1 pt = 1/72 inch). */
export const PAPER_SIZES = {
  a4:        { width: 595.28,  height: 841.89,  label: "A4" },
  letter:    { width: 612,     height: 792,     label: "Letter" },
  legal:     { width: 612,     height: 1008,    label: "Oficio / Legal" },
  a3:        { width: 841.89,  height: 1190.55, label: "A3" },
  a5:        { width: 419.53,  height: 595.28,  label: "A5" },
  executive: { width: 521.86,  height: 756,     label: "Executive" },
  b5:        { width: 498.9,   height: 708.66,  label: "B5" },
  tabloid:   { width: 792,     height: 1224,    label: "Tabloid / Ledger" },
};

/** Remove dangerous tags and event-handler attributes from HTML before rendering. */
function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style\s*>/gi, "")
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

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

const CAPTURE_SCALE = 2;
const PT2CSS = 96 / 72;


function cssPx(value) { return `${value}px`; }

function ptToCss(pt) { return pt * PT2CSS; }

async function detectDocxLayout(arrayBuffer) {
  // Returns { width, height, margins: {top,right,bottom,left} } all in PDF points
  const result = { width: PAPER_SIZES.a4.width, height: PAPER_SIZES.a4.height,
                   margins: { top: 56.7, right: 42.5, bottom: 56.7, left: 85.05 } };
  try {
    const JSZipLib = globalThis.JSZip;
    if (!JSZipLib) return result;
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const file = zip.files["word/document.xml"];
    if (!file) return result;
    const xml = await file.async("text");
    // Page size
    const szTag = xml.match(/<[^>]*pgSz[^>]*\/?>/i);
    if (szTag) {
      const w = szTag[0].match(/\bw:w\s*=\s*["'](\d+)["']/i) || szTag[0].match(/\bw\s*=\s*["'](\d+)["']/i);
      const h = szTag[0].match(/\bw:h\s*=\s*["'](\d+)["']/i) || szTag[0].match(/\bh\s*=\s*["'](\d+)["']/i);
      if (w && h) {
        const pw = Number(w[1]) / 20, ph = Number(h[1]) / 20;
        if (pw > 0 && ph > 0) { result.width = pw; result.height = ph; }
      }
    }
    // Page margins (w:pgMar) — values are in twentieths of a point
    const marTag = xml.match(/<[^>]*pgMar[^>]*\/?>/i);
    if (marTag) {
      const top    = marTag[0].match(/w:top\s*=\s*["'](\d+)["']/i);
      const right  = marTag[0].match(/w:right\s*=\s*["'](\d+)["']/i);
      const bottom = marTag[0].match(/w:bottom\s*=\s*["'](\d+)["']/i);
      const left   = marTag[0].match(/w:left\s*=\s*["'](\d+)["']/i);
      if (top)    result.margins.top    = Number(top[1])    / 20;
      if (right)  result.margins.right  = Number(right[1])  / 20;
      if (bottom) result.margins.bottom = Number(bottom[1]) / 20;
      if (left)   result.margins.left   = Number(left[1])   / 20;
    }
  } catch (err) {
    console.warn("[BeeTales] DOCX layout detection failed:", err);
  }
  return result;
}

/**
 * Open the DOCX ZIP once and return all per-paragraph properties needed for
 * faithful rendering: alignment, indentation, spacing, and page-break flags.
 * Resolves paragraph-style inheritance for each property.
 */
async function extractDocxParagraphProps(arrayBuffer) {
  const empty = { alignments: [], indents: [], spacings: [], pageBreaks: [] };
  try {
    const JSZipLib = globalThis.JSZip;
    if (!JSZipLib) return empty;
    const zip = await JSZipLib.loadAsync(arrayBuffer);

    // ── Build style maps (styleId → property value) ──────────────────────────
    const styleJc  = {}; // alignment
    const styleInd = {}; // indentation
    const styleSpc = {}; // spacing
    const stylesFile = zip.files["word/styles.xml"];
    if (stylesFile) {
      const sxml = await stylesFile.async("text");
      for (const block of sxml.match(/<w:style\b[\s\S]*?<\/w:style>/gi) || []) {
        const id = (block.match(/w:styleId="([^"]+)"/) || [])[1];
        if (!id) continue;
        const pPr = (block.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || "";
        const jc   = (pPr.match(/<w:jc\s+w:val="([^"]+)"/)      || [])[1];
        const ind  = pPr.match(/<w:ind\b([^/]*)\/?>/);
        const spc  = pPr.match(/<w:spacing\b([^/]*)\/?>/);
        if (jc)  styleJc[id]  = jc;
        if (ind) styleInd[id] = ind[0];
        if (spc) styleSpc[id] = spc[0];
      }
    }

    // ── Build numbering format map ────────────────────────────────────────────
    const numFmtMap = {}; // "numId:ilvl" → { format, lvlText, indent }
    const numFile = zip.files["word/numbering.xml"];
    if (numFile) {
      const nxml = await numFile.async("text");
      // abstractNum: define formats per level
      const abstractNums = {};
      for (const ab of nxml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/gi) || []) {
        const abId = (ab.match(/w:abstractNumId="([^"]+)"/) || [])[1];
        if (!abId) continue;
        const levels = {};
        for (const lvl of ab.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/gi) || []) {
          const ilvl   = (lvl.match(/w:ilvl="([^"]+)"/)          || [])[1];
          const fmt    = (lvl.match(/<w:numFmt\s+w:val="([^"]+)"/)  || [])[1];
          const text   = (lvl.match(/<w:lvlText\s+w:val="([^"]+)"/) || [])[1];
          const indTag = lvl.match(/<w:ind\b([^/]*)\/?>/);
          if (ilvl != null) levels[ilvl] = { fmt: fmt || "bullet", text: text || "•",
                                              indTag: indTag ? indTag[0] : "" };
        }
        abstractNums[abId] = levels;
      }
      // num: map numId → abstractNumId
      for (const num of nxml.match(/<w:num\b[\s\S]*?<\/w:num>/gi) || []) {
        const nId  = (num.match(/w:numId="([^"]+)"/)                    || [])[1];
        const abId = (num.match(/<w:abstractNumId\s+w:val="([^"]+)"/)   || [])[1];
        if (nId && abId && abstractNums[abId]) {
          for (const [ilvl, info] of Object.entries(abstractNums[abId])) {
            numFmtMap[`${nId}:${ilvl}`] = info;
          }
        }
      }
    }

    // ── Walk document body paragraphs ─────────────────────────────────────────
    const docFile = zip.files["word/document.xml"];
    if (!docFile) return empty;
    const xml  = await docFile.async("text");
    const body = (xml.match(/<w:body>([\s\S]*?)<\/w:body>/) || [])[1] || xml;

    const alignments = [], indents = [], spacings = [], pageBreaks = [];

    for (const para of body.match(/<w:p[ >][\s\S]*?<\/w:p>/gi) || []) {
      const pPr   = (para.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || "";
      const styleId = (pPr.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || "";

      // ── Alignment ──
      const jc = (pPr.match(/<w:jc\s+w:val="([^"]+)"/) || [])[1]
              || (styleId && styleJc[styleId]) || "";
      alignments.push(jc);

      // ── Indentation (merge style + direct; direct wins per-attr) ──
      const indDirect = (pPr.match(/<w:ind\b([^/]*)\/?>/)  || [])[0] || "";
      const indStyle  = (styleId && styleInd[styleId]) || "";
      // Also check numbering indentation
      const numId = (pPr.match(/<w:numId\s+w:val="([^"]+)"/)  || [])[1];
      const ilvl  = (pPr.match(/<w:ilvl\s+w:val="([^"]+)"/)   || [])[1] || "0";
      const numInfo = numId ? numFmtMap[`${numId}:${ilvl}`] : null;
      const indNum  = numInfo ? numInfo.indTag : "";
      const indSrc  = indDirect || indNum || indStyle;
      const getIndAttr = (src, attr) => { const m = src.match(new RegExp(`w:${attr}="([-\\d]+)"`)); return m ? Number(m[1]) / 20 : null; };
      indents.push({
        left:      getIndAttr(indSrc, "left"),
        right:     getIndAttr(indSrc, "right"),
        firstLine: getIndAttr(indDirect || indStyle, "firstLine"),
        hanging:   getIndAttr(indDirect || indStyle, "hanging"),
        numId, ilvl,
      });

      // ── Spacing ──
      const spcDirect = (pPr.match(/<w:spacing\b([^/]*)\/?>/) || [])[0] || "";
      const spcStyle  = (styleId && styleSpc[styleId]) || "";
      const spcSrc    = spcDirect || spcStyle;
      const getSpcAttr = (src, attr) => { const m = src.match(new RegExp(`w:${attr}="([-\\d]+)"`)); return m ? Number(m[1]) / 20 : null; };
      const lineVal  = getSpcAttr(spcSrc, "line");
      const lineRule = (spcSrc.match(/w:lineRule="([^"]+)"/) || [])[1] || "auto";
      let lineHeight = null;
      if (lineVal !== null) {
        // lineRule="exact"|"atLeast" → value is in twips → pt; "auto" → value/240 multiplier
        lineHeight = lineRule === "auto" ? lineVal / 12 : lineVal; // auto: 240=single=1.0 line
      }
      spacings.push({
        before: getSpcAttr(spcSrc, "before"),
        after:  getSpcAttr(spcSrc, "after"),
        lineHeight,
        lineRule,
      });

      // ── Page break ──
      const hasPageBreak = /<w:pageBreakBefore\/>/.test(pPr)
                        || /<w:pageBreakBefore\s+w:val="1"/.test(pPr)
                        || /<w:br\s+w:type="page"/.test(para);
      pageBreaks.push(hasPageBreak);
    }

    return { alignments, indents, spacings, pageBreaks, numFmtMap };
  } catch (err) {
    console.warn("[BeeTales] DOCX paragraph property extraction failed:", err);
    return empty;
  }
}

/**
 * Inject alignment, indentation, spacing, and page-break styles into mammoth HTML.
 * Replaces the old injectParagraphAlignments — now handles all paragraph properties
 * extracted by extractDocxParagraphProps.
 */
function injectParagraphStyles(html, props) {
  const { alignments = [], indents = [], spacings = [], pageBreaks = [] } = props;
  if (!alignments.length && !indents.length && !spacings.length && !pageBreaks.length) return html;
  const alignCss = { center: "center", right: "right", both: "justify", distribute: "justify" };
  let idx = 0;

  // Pre-inject page-break divs before paragraphs that need them
  // Then inject inline styles on <p> elements
  return html.replace(/<p(\s[^>]*)?>/gi, (match, attrs) => {
    const i = idx++;
    const parts = [];

    // Alignment
    const al = alignCss[alignments[i] || ""];
    if (al) parts.push(`text-align:${al}`);

    // Indentation (convert pt to em relative to 11pt base for robustness)
    const ind = indents[i] || {};
    if (ind.left  != null) parts.push(`margin-left:${ind.left}pt`);
    if (ind.right != null) parts.push(`margin-right:${ind.right}pt`);
    if (ind.firstLine != null && ind.firstLine > 0) parts.push(`text-indent:${ind.firstLine}pt`);
    else if (ind.hanging != null && ind.hanging > 0) parts.push(`text-indent:-${ind.hanging}pt`,`padding-left:${ind.hanging}pt`);

    // Spacing
    const spc = spacings[i] || {};
    if (spc.before != null) parts.push(`margin-top:${spc.before}pt`);
    if (spc.after  != null) parts.push(`margin-bottom:${spc.after}pt`);
    else parts.push(`margin-bottom:8pt`); // default Word spacing-after
    if (spc.lineHeight != null) {
      const lh = spc.lineRule === "auto" ? (spc.lineHeight / 20).toFixed(3) : `${spc.lineHeight}pt`;
      parts.push(`line-height:${lh}`);
    } else {
      parts.push(`line-height:1.15`);
    }

    // Page break prefix
    const pb = pageBreaks[i] ? `<div style="break-before:page;page-break-before:always"></div>` : "";

    if (!parts.length) return `${pb}${match}`;
    attrs = attrs || "";
    const styleMatch = /\bstyle="([^"]*)"/i.exec(attrs);
    if (styleMatch) {
      return `${pb}<p${attrs.replace(/\bstyle="([^"]*)"/i, `style="${styleMatch[1]}${parts.join(";")};"`)}}>`;
    }
    return `${pb}<p${attrs} style="${parts.join(";")};">`;
  });
}

function getRenderContainer(cssWidth) {
  let el = document.getElementById("ofc-render");
  if (!el) {
    el = document.createElement("div");
    el.id = "ofc-render";
    el.style.cssText = `position:fixed;top:-99999px;left:0;background:#fff;box-sizing:border-box`;
    document.body.append(el);
  }
  el.style.width = cssPx(cssWidth);
  el.style.height = "";
  el.innerHTML = "";
  return el;
}

function resetRenderContainer() {
  const el = document.getElementById("ofc-render");
  if (el) el.remove();
}

async function settle(el) {
  await document.fonts.ready;
  const imgs = el ? Array.from(el.querySelectorAll("img")) : [];
  if (imgs.length) {
    await Promise.all(imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return;
      return new Promise((r) => { img.onload = r; img.onerror = r; });
    }));
  }
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 50));
}

/** Check if a canvas has non-white content */
function isCanvasBlank(canvas) {
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(0, 0, canvas.width, Math.min(16, canvas.height)).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
  }
  return true;
}

/** Wait until the canvas has visible content or max attempts reached */
async function waitForCanvasContent(canvas, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!isCanvasBlank(canvas)) return;
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function captureHtml(pdfDoc, html, pageWidthPt, pageHeightPt, marginPt = 0, cssReset = "") {
  const cssW = ptToCss(pageWidthPt);
  const cssH = ptToCss(pageHeightPt);
  const marginCss = ptToCss(marginPt);
  // Render content at printable width (page minus left+right margins)
  const printableW = Math.max(1, cssW - 2 * marginCss);
  const printableH = Math.max(1, cssH - 2 * marginCss);

  const el = getRenderContainer(printableW);
  el.innerHTML = sanitizeHtml(html);
  // Inject trusted CSS reset after sanitisation so it is never stripped
  if (cssReset) {
    const styleEl = document.createElement("style");
    styleEl.textContent = cssReset;
    el.prepend(styleEl);
  }
  await settle(el);
  // Second rAF pass guards against browsers that return scrollHeight=0 on off-screen elements
  await new Promise((r) => requestAnimationFrame(r));
  const contentH = Math.max(printableH, el.scrollHeight);

  const full = await html2canvas(el, {
    scale: CAPTURE_SCALE,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: Math.round(printableW),
    height: Math.round(contentH),
  });

  // Page dimensions in canvas pixels
  const printableHPx = Math.round(printableH * CAPTURE_SCALE);
  const pageWPx = Math.round(cssW * CAPTURE_SCALE);
  const pageHPx = Math.round(cssH * CAPTURE_SCALE);
  const marginPx = Math.round(marginCss * CAPTURE_SCALE);
  const totalH = full.height;
  const count = Math.ceil(totalH / printableHPx);

  try {
    for (let i = 0; i < count; i++) {
      const srcY = i * printableHPx;
      const srcH = Math.min(printableHPx, totalH - srcY);

      // Compose a full-page canvas: white background + content inset by the margin on all sides
      const chunk = document.createElement("canvas");
      chunk.width = pageWPx;
      chunk.height = pageHPx;
      const ctx = chunk.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageWPx, pageHPx);
      // Content starts at (marginPx, marginPx) — this gives correct top margin on every page
      ctx.drawImage(full, 0, srcY, full.width, srcH, marginPx, marginPx, full.width, srcH);

      const blob = await new Promise((r) => chunk.toBlob(r, "image/jpeg", 0.92));
      const img = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      pdfPage.drawImage(img, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
    }
  } finally {
    el.innerHTML = "";
  }
}

export async function convertDocxToPdfPages(arrayBuffer, pdfDoc, paperKey = "auto", marginPt = 0) {
  resetRenderContainer();
  const mammothLib = globalThis.mammoth;
  if (!mammothLib) throw new Error("mammoth library is not available.");

  // ── 1. Detect page layout (size + real DOCX margins) ─────────────────────
  const layout = await detectDocxLayout(arrayBuffer);
  let pw, ph, docMarginPt;
  if (PAPER_SIZES[paperKey]) {
    pw = PAPER_SIZES[paperKey].width;
    ph = PAPER_SIZES[paperKey].height;
    docMarginPt = marginPt; // user-selected margin wins when a size is forced
  } else {
    pw = layout.width;
    ph = layout.height;
    // If the UI says "Detect" (paperKey=="auto") use the DOCX margins;
    // if UI says "None" (marginPt===0), honour that.
    docMarginPt = marginPt === 0 ? 0 : layout.margins.top; // symmetric simplification
  }

  // ── 2. Extract paragraph properties (alignment, indent, spacing, breaks) ─
  const props = await extractDocxParagraphProps(arrayBuffer);

  // ── 3. Convert DOCX → HTML with mammoth (including embedded images) ───────
  const result = await mammothLib.convertToHtml({
    arrayBuffer,
    ignoreEmptyParagraphs: false,
    convertImage: mammothLib.images.imgElement(async (image) => {
      try {
        const b64 = await image.read("base64");
        return { src: `data:${image.contentType};base64,${b64}` };
      } catch { return {}; }
    }),
  });
  const rawHtml = (result.value || "").trim();
  if (!rawHtml) throw new Error("The document appears to be empty or contains no extractable text.");

  // ── 4. Inject paragraph styles extracted from the DOCX XML ────────────────
  const html = injectParagraphStyles(rawHtml, props);

  // ── 5. Build CSS reset (Word defaults + font aliases + table/list rules) ──
  const docxCss = [
    // Font aliases: local MS font → web-font substitute when MS font not installed
    "@font-face{font-family:'Calibri';src:local('Calibri'),local('carlito regular'),local('Carlito');font-weight:400;font-style:normal}",
    "@font-face{font-family:'Calibri';src:local('Calibri Bold'),local('carlito bold'),local('Carlito');font-weight:700;font-style:normal}",
    "@font-face{font-family:'Calibri';src:local('Calibri Italic'),local('Carlito Italic');font-weight:400;font-style:italic}",
    "@font-face{font-family:'Arial';src:local('Arial'),local('arimo regular'),local('Arimo');font-weight:400;font-style:normal}",
    "@font-face{font-family:'Arial';src:local('Arial Bold'),local('Arimo Bold');font-weight:700;font-style:normal}",
    "@font-face{font-family:'Times New Roman';src:local('Times New Roman'),local('tinos regular'),local('Tinos');font-weight:400;font-style:normal}",
    "@font-face{font-family:'Times New Roman';src:local('Times New Roman Bold'),local('Tinos Bold');font-weight:700;font-style:normal}",
    "@font-face{font-family:'Courier New';src:local('Courier New'),local('cousine regular'),local('Cousine');font-weight:400;font-style:normal}",
    // Base reset — injectParagraphStyles overrides per-paragraph via inline styles
    "p{margin:0 0 8pt 0;line-height:1.15}",
    // Lists — numbering style overrides are handled by injectParagraphStyles indentation
    "ul{list-style-type:disc;margin:0 0 8pt 0;padding-left:36pt}",
    "ol{list-style-type:decimal;margin:0 0 8pt 0;padding-left:36pt}",
    "li{margin-bottom:0;line-height:1.15}",
    // Headings
    "h1{font-size:16pt;margin:0 0 8pt 0;line-height:1.15}h2{font-size:14pt;margin:0 0 8pt 0;line-height:1.15}",
    "h3,h4,h5,h6{margin:0 0 8pt 0;line-height:1.15}",
    // Tables — column widths are set via inline width attrs injected below
    "table{border-collapse:collapse;width:100%;margin-bottom:8pt;table-layout:fixed}",
    "td,th{padding:3pt 6pt;border:1px solid #bbb;vertical-align:top;overflow:hidden;word-break:break-word}",
    // Images
    "img{max-width:100%;height:auto}",
  ].join("");

  await captureHtml(pdfDoc,
    `<div style="box-sizing:border-box;font-family:Calibri,Carlito,'Segoe UI',Arimo,Arial,sans-serif;font-size:11pt;line-height:1.15;color:#000">${html}</div>`,
    pw, ph, docMarginPt, docxCss);
}

export async function convertXlsxToPdfPages(arrayBuffer, pdfDoc, paperKey = "a4", marginPt = 0) {
  resetRenderContainer();
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The spreadsheet contains no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
  if (!html) throw new Error("The spreadsheet contains no data.");
  const paper = PAPER_SIZES[paperKey] || PAPER_SIZES.a4;
  const xlsxCss = [
    "table{border-collapse:collapse;width:100%}",
    "td,th{padding:3pt 6pt;border:1px solid #ccc;vertical-align:top;white-space:nowrap}",
    "tr:nth-child(even) td{background:#f7f7f7}",
    "th{background:#e8e8e8;font-weight:bold}",
  ].join("");
  // Margins are applied by captureHtml — no padding needed in the wrapper
  await captureHtml(pdfDoc,
    `<div style="box-sizing:border-box;font-family:Calibri,Carlito,'Segoe UI',Arimo,Arial,sans-serif;font-size:10pt;line-height:1.15;color:#000">${html}</div>`,
    paper.width, paper.height, marginPt, xlsxCss);
}

/** Sample multiple rows of canvas to detect content */
function isCanvasBlankDeep(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const sampleRows = [0, Math.floor(h / 4), Math.floor(h / 2), Math.floor(3 * h / 4), h - 1];
  for (const row of sampleRows) {
    if (row < 0 || row >= h) continue;
    const data = ctx.getImageData(0, row, Math.min(w, 32), 1).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
    }
  }
  return true;
}

/** Extract slide text directly from PPTX XML for fallback rendering */
function extractSlideTextSimple(renderer, slideIndex) {
  try {
    const slidePath = renderer.slidePaths[slideIndex];
    if (!slidePath) return null;
    const xml = renderer._readText(slidePath);
    if (!xml) return null;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const texts = [];
    for (const t of doc.querySelectorAll("t")) {
      if (t.textContent) texts.push(t.textContent.trim());
    }
    return texts.length ? texts.join("\n") : null;
  } catch { return null; }
}

/** Render text content onto a canvas as a simple fallback */
function renderFallbackSlide(canvas, text, pw, ph) {
  const scale = 2;
  const w = Math.round(pw * PT2CSS * scale);
  const h = Math.round(ph * PT2CSS * scale);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#222222";
  ctx.textBaseline = "top";
  const margin = Math.round(40 * scale);
  const maxW = w - margin * 2;
  ctx.font = `${Math.round(14 * scale)}px sans-serif`;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let y = margin;
  for (const line of lines) {
    if (y > h - margin) break;
    if (ctx.measureText(line).width <= maxW) {
      ctx.fillText(line, margin, y);
      y += Math.round(20 * scale);
    } else {
      const words = line.split(" ");
      let x = margin;
      for (const word of words) {
        const wordW = ctx.measureText(word + " ").width;
        if (x + wordW > margin + maxW) { x = margin; y += Math.round(20 * scale); }
        ctx.fillText(word, x, y);
        x += wordW;
      }
      y += Math.round(20 * scale);
    }
    if (y > h - margin) break;
  }
}

export async function convertPptxToPdfPages(arrayBuffer, pdfDoc) {
  resetRenderContainer();
  const { PptxRenderer } = await import("./vendor/pptx-browser/index.js");
  const renderer = new PptxRenderer();
  try {
    await renderer.load(arrayBuffer);
    if (!renderer.slideCount) throw new Error("No slides found in this presentation.");
    const { widthEmu, heightEmu } = renderer.getInfo();
    const pw = widthEmu / 12700;
    const ph = heightEmu / 12700;
    const cssW = Math.round(ptToCss(pw));
    for (let i = 0; i < renderer.slideCount; i++) {
      try {
        const canvas = document.createElement("canvas");
        const rw = Math.round(cssW * CAPTURE_SCALE);
        await renderer.renderSlide(i, canvas, rw);

        // Debug: show canvas as visible image on page
        if (window.__PPTX_DEBUG) {
          const debugImg = document.createElement("img");
          debugImg.src = canvas.toDataURL("image/jpeg", 0.85);
          debugImg.style.cssText = "position:fixed;bottom:10px;right:10px;z-index:99999;max-width:300px;max-height:200px;border:3px solid red;background:#fff;box-shadow:0 0 20px rgba(0,0,0,0.5);";
          debugImg.title = `Slide ${i + 1} (click to close)`;
          debugImg.onclick = () => debugImg.remove();
          document.body.append(debugImg);
        }

        if (!isCanvasBlankDeep(canvas)) {
          const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.92));
          const img = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const page = pdfDoc.addPage([pw, ph]);
          page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
        } else {
          console.warn("Slide", i + 1, "blank after pptx-browser — trying text fallback");
          const text = extractSlideTextSimple(renderer, i);
          if (text) {
            const fbCanvas = document.createElement("canvas");
            renderFallbackSlide(fbCanvas, text, pw, ph);
            const blob = await new Promise((r) => fbCanvas.toBlob(r, "image/jpeg", 0.92));
            const img = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
            const page = pdfDoc.addPage([pw, ph]);
            page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
          } else {
            const page = pdfDoc.addPage([pw, ph]);
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            page.drawText(`[Slide ${i + 1}]`, { x: 50, y: ph - 50, size: 18, font, color: rgb(0.5, 0.5, 0.5) });
          }
        }
      } catch (err) {
        console.warn("Skipped blank/failed slide", i + 1, err.message);
        try {
          const text = extractSlideTextSimple(renderer, i);
          if (text) {
            const fbCanvas = document.createElement("canvas");
            renderFallbackSlide(fbCanvas, text, pw, ph);
            const blob = await new Promise((r) => fbCanvas.toBlob(r, "image/jpeg", 0.92));
            const img = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
            const page = pdfDoc.addPage([pw, ph]);
            page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
          } else {
            const page = pdfDoc.addPage([pw, ph]);
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            page.drawText(`[Slide ${i + 1}]`, { x: 50, y: ph - 50, size: 18, font, color: rgb(0.5, 0.5, 0.5) });
          }
        } catch {}
      }
    }
  } finally {
    renderer.destroy();
  }
}

export async function buildMixedPdf(imageItems, paperKey = "image", marginPt = 24) {
  const output = await PDFDocument.create();
  const fixedPaper = PAPER_SIZES[paperKey];
  for (const item of imageItems) {
    const type = item.file.type || "";
    const ext = item.file.name.split(".").pop().toLowerCase();
    if (type.startsWith("image/") || ["png", "jpg", "jpeg"].includes(ext)) {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const image = type === "image/png" || ext === "png" ? await output.embedPng(bytes) : await output.embedJpg(bytes);
      if (fixedPaper) {
        // Fit image within the chosen paper size, centred with the specified margin
        const pw = fixedPaper.width;
        const ph = fixedPaper.height;
        const m = Math.max(0, marginPt);
        const availW = Math.max(1, pw - 2 * m);
        const availH = Math.max(1, ph - 2 * m);
        const scale = Math.min(availW / image.width, availH / image.height, 1);
        const iw = image.width * scale;
        const ih = image.height * scale;
        const x = m + (availW - iw) / 2;
        const y = m + (availH - ih) / 2;
        const page = output.addPage([pw, ph]);
        page.drawImage(image, { x, y, width: iw, height: ih });
      } else {
        // "Fit each image" / "auto" — use natural image dimensions (capped at 1440 px)
        const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
        const pw = image.width * scale;
        const ph = image.height * scale;
        const page = output.addPage([pw, ph]);
        page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      }
    } else if (ext === "docx") {
      await convertDocxToPdfPages(await item.file.arrayBuffer(), output, paperKey, marginPt);
    } else if (ext === "xlsx") {
      await convertXlsxToPdfPages(await item.file.arrayBuffer(), output, paperKey, marginPt);
    } else if (ext === "pptx") {
      await convertPptxToPdfPages(await item.file.arrayBuffer(), output);
    }
  }
  return output.save();
}
