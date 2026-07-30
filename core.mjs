import { PDFDocument, StandardFonts, degrees, rgb } from "./vendor/pdf-lib/pdf-lib.esm.min.js";
import * as XLSX from "./vendor/xlsx/xlsx.mjs";
import html2canvas from "./vendor/html2canvas/html2canvas.esm.js";

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

async function detectDocxPageSize(arrayBuffer) {
  try {
    const JSZipLib = globalThis.JSZip;
    if (!JSZipLib) return null;
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const file = zip.files["word/document.xml"];
    if (!file) return null;
    const xml = await file.async("text");
    const tag = xml.match(/<[^>]*pgSz[^>]*\/?>/i);
    if (tag) {
      const w = tag[0].match(/\bw:w\s*=\s*["'](\d+)["']/i) || tag[0].match(/\bw\s*=\s*["'](\d+)["']/i);
      const h = tag[0].match(/\bw:h\s*=\s*["'](\d+)["']/i) || tag[0].match(/\bh\s*=\s*["'](\d+)["']/i);
      if (w && h) {
        const width = Number(w[1]) / 20;
        const height = Number(h[1]) / 20;
        if (width > 0 && height > 0) return { width, height };
      }
    }
  } catch {}
  return null;
}

async function detectPptxPageSize(arrayBuffer) {
  try {
    const JSZipLib = globalThis.JSZip;
    if (!JSZipLib) return null;
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const file = zip.files["ppt/presentation.xml"];
    if (!file) return null;
    const xml = await file.async("text");
    const tag = xml.match(/<[^>]*slideSize[^>]*\/?>/i);
    if (tag) {
      const cx = tag[0].match(/\bcx\s*=\s*["'](\d+)["']/i);
      const cy = tag[0].match(/\bcy\s*=\s*["'](\d+)["']/i);
      if (cx && cy) {
        const w = Number(cx[1]) / 12700;
        const h = Number(cy[1]) / 12700;
        if (w > 0 && h > 0) return { width: w, height: h };
      }
    }
  } catch {}
  return null;
}

function getRenderContainer(cssWidth) {
  let el = document.getElementById("ofc-render");
  if (!el) {
    el = document.createElement("div");
    el.id = "ofc-render";
    el.style.cssText = `position:fixed;top:0;left:-9999px;overflow:visible;background:#fff;z-index:-1;box-sizing:border-box`;
    document.body.append(el);
  }
  el.style.width = cssPx(cssWidth);
  el.innerHTML = "";
  return el;
}

async function settle() {
  await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 50));
}

async function captureHtml(pdfDoc, html, pageWidthPt, pageHeightPt) {
  const cssW = ptToCss(pageWidthPt);
  const cssH = ptToCss(pageHeightPt);
  const el = getRenderContainer(cssW);
  el.innerHTML = html;
  await settle();

  const full = await html2canvas(el, {
    scale: CAPTURE_SCALE,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const pageH = Math.round(cssH * CAPTURE_SCALE);
  const pageW = Math.round(cssW * CAPTURE_SCALE);
  const totalH = full.height;
  const count = Math.ceil(totalH / pageH);

  for (let i = 0; i < count; i++) {
    const srcY = i * pageH;
    const srcH = Math.min(pageH, totalH - srcY);
    const chunk = document.createElement("canvas");
    chunk.width = pageW;
    chunk.height = srcH;
    const ctx = chunk.getContext("2d");
    ctx.drawImage(full, 0, srcY, pageW, srcH, 0, 0, pageW, srcH);

    const blob = await new Promise((r) => chunk.toBlob(r, "image/jpeg", 0.92));
    const img = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));

    const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    const drawCSS = srcH / CAPTURE_SCALE;
    const drawPt = drawCSS / PT2CSS;
    pdfPage.drawImage(img, { x: 0, y: pageHeightPt - drawPt, width: pageWidthPt, height: drawPt });
  }

  el.innerHTML = "";
}

export async function convertDocxToPdfPages(arrayBuffer, pdfDoc) {
  const mammothLib = globalThis.mammoth;
  if (!mammothLib) throw new Error("mammoth library is not available.");
  const size = await detectDocxPageSize(arrayBuffer);
  const pw = size ? size.width : 595.28;
  const ph = size ? size.height : 841.89;
  const result = await mammothLib.convertToHtml({ arrayBuffer });
  const html = (result.value || "").trim();
  if (!html) throw new Error("The document appears to be empty or contains no extractable text.");
  await captureHtml(pdfDoc,
    `<div style="box-sizing:border-box;font-family:Calibri,Segoe UI,Roboto,sans-serif;font-size:12pt;line-height:1.35;color:#000;padding:72px">${html}</div>`,
    pw, ph);
}

export async function convertXlsxToPdfPages(arrayBuffer, pdfDoc) {
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The spreadsheet contains no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
  if (!html) throw new Error("The spreadsheet contains no data.");
  await captureHtml(pdfDoc,
    `<div style="box-sizing:border-box;font-family:Calibri,Segoe UI,Roboto,sans-serif;font-size:10pt;color:#000;padding:54px">${html}</div>`,
    595.28, 841.89);
}

function child(el, tag) { if (!el) return null; for (const c of el.children) if (c.localName === tag) return c; return null; }
function children(el, tag) { if (!el) return []; return Array.from(el.children).filter((c) => c.localName === tag); }

function parseColor(el) {
  if (!el) return null;
  const srgb = child(el, "srgbClr");
  return srgb ? "#" + srgb.getAttribute("val") : null;
}

function runCss(rPr) {
  const s = {};
  if (!rPr) return s;
  const sz = rPr.getAttribute("sz");
  if (sz) s["font-size"] = (parseInt(sz) / 100) + "pt";
  if (rPr.getAttribute("b") === "1") s["font-weight"] = "bold";
  if (rPr.getAttribute("i") === "1") s["font-style"] = "italic";
  const u = rPr.getAttribute("u");
  if (u && u !== "none") s["text-decoration"] = "underline";
  const c = parseColor(child(rPr, "solidFill"));
  if (c) s.color = c;
  const latin = child(rPr, "latin");
  if (latin) { const tf = latin.getAttribute("typeface"); if (tf) s["font-family"] = `"${tf}",sans-serif`; }
  return s;
}

function cssText(o) { return Object.entries(o).map(([k, v]) => `${k}:${v}`).join(";"); }

function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function buildTextHtml(txBody) {
  const parts = [];
  for (const p of children(txBody, "p")) {
    const pPr = child(p, "pPr");
    let pStyle = "";
    const algn = pPr && pPr.getAttribute("algn");
    if (algn === "ctr") pStyle += "text-align:center;";
    else if (algn === "r") pStyle += "text-align:right;";
    else if (algn === "just") pStyle += "text-align:justify;";
    const indent = pPr && pPr.getAttribute("lvl") ? parseInt(pPr.getAttribute("lvl")) : 0;
    if (indent) pStyle += `padding-left:${indent * 20}pt;`;
    parts.push(`<p style="${pStyle}margin:0">`);
    for (const childEl of p.children) {
      if (childEl.localName === "r") {
        const t = child(childEl, "t");
        if (!t) continue;
        const cs = runCss(child(childEl, "rPr"));
        parts.push(Object.keys(cs).length ? `<span style="${cssText(cs)}">${escapeHtml(t.textContent)}</span>` : escapeHtml(t.textContent));
      } else if (childEl.localName === "br") {
        parts.push("<br>");
      }
    }
    parts.push("</p>");
  }
  return parts.join("");
}

function getXfrm(spPr) {
  if (!spPr) return null;
  const xfrm = child(spPr, "xfrm");
  if (!xfrm) return null;
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  if (!off || !ext) return null;
  return {
    x: parseInt(off.getAttribute("x") || "0"),
    y: parseInt(off.getAttribute("y") || "0"),
    cx: parseInt(ext.getAttribute("cx") || "0"),
    cy: parseInt(ext.getAttribute("cy") || "0"),
  };
}

function shapeBackCss(spPr) {
  const s = {};
  const solid = child(spPr, "solidFill");
  if (solid) { const c = parseColor(solid); if (c) s["background-color"] = c; }
  const grad = child(spPr, "gradFill");
  if (grad) {
    const gsLst = child(grad, "gsLst");
    if (gsLst) {
      const stops = children(gsLst, "gs");
      if (stops.length) {
        const a = parseColor(stops[0]), b = parseColor(stops[stops.length - 1]);
        if (a && b) s.background = `linear-gradient(${a},${b})`;
      }
    }
  }
  const ln = child(spPr, "ln");
  if (ln) {
    const w = ln.getAttribute("w");
    if (w) s["border-width"] = (parseInt(w) / 12700) + "pt";
    const lc = parseColor(child(ln, "solidFill"));
    if (lc) s["border-color"] = lc;
    s["border-style"] = "solid";
  }
  return s;
}

function getREmbed(el) {
  return el.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed")
      || el.getAttribute("r:embed");
}

function bgHtml(cSld, relsMap, mediaUrls) {
  let h = "";
  const bg = child(cSld, "bg");
  if (!bg) return h;
  const bgPr = child(bg, "bgPr");
  if (!bgPr) return h;
  const ref = getREmbed(bgPr);
  if (ref && relsMap[ref] && mediaUrls[relsMap[ref]])
    h += `<img src="${mediaUrls[relsMap[ref]]}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none">`;
  const c = parseColor(child(bgPr, "solidFill"));
  if (c) h += `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:${c};pointer-events:none"></div>`;
  return h;
}

async function loadMediaUrls(zip) {
  const map = {};
  const tasks = [];
  for (const path of Object.keys(zip.files)) {
    if (/^ppt\/media\//.test(path) && !zip.files[path].dir) {
      tasks.push((async () => {
        const ext = path.split(".").pop().toLowerCase();
        const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
        const b64 = await zip.files[path].async("base64");
        map[path] = `data:${mime};base64,${b64}`;
      })());
    }
  }
  await Promise.all(tasks);
  return map;
}

function stripHiddenFlags(cSld) {
  const spTree = child(cSld, "spTree");
  if (!spTree) return;
  const elements = [];
  for (const el of spTree.children) {
    const ln = el.localName;
    if (ln !== "sp" && ln !== "pic") continue;
    const nvPr = child(el, ln === "pic" ? "nvPicPr" : "nvSpPr");
    const cNvPr = nvPr && child(nvPr, "cNvPr");
    if (cNvPr && cNvPr.getAttribute("hidden") === "1") cNvPr.removeAttribute("hidden");
    elements.push(cNvPr);
  }
  const timing = child(cSld.parentElement, "timing");
  if (!timing) return;
  const tgts = timing.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "spTgt") || timing.getElementsByTagName("spTgt");
  const animated = new Set();
  for (const t of tgts) {
    const id = t.getAttribute("spid");
    if (id) animated.add(id);
  }
  for (const cNvPr of elements) {
    if (cNvPr && animated.has(cNvPr.getAttribute("id"))) cNvPr.removeAttribute("hidden");
  }
}

function buildSlideHtml(cSld, slideW, slideH, containerW, containerH, relsMap, mediaUrls) {
  const stack = [];
  stack.push(`<div style="position:relative;overflow:hidden;width:${containerW}px;height:${containerH}px;background:#fff;font-family:Calibri,Segoe UI,Roboto,sans-serif;color:#000;box-sizing:border-box">`);

  const bg = child(cSld, "bg");
  if (bg) {
    const bgPr = child(bg, "bgPr");
    if (bgPr) {
      const bgRef = getREmbed(bgPr);
      if (bgRef && relsMap[bgRef] && mediaUrls[relsMap[bgRef]])
        stack.push(`<img src="${mediaUrls[relsMap[bgRef]]}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none">`);
      const bgC = parseColor(child(bgPr, "solidFill"));
      if (bgC) stack.push(`<div style="position:absolute;top:0;left:0;width:100%;height:100%;background:${bgC};pointer-events:none"></div>`);
    }
  }

  function pct(v) { return (v / slideW) * 100; }
  function pctH(v) { return (v / slideH) * 100; }

  function posDiv(el, gx, gy) {
    if (!el) return;
    const ln = el.localName;
    if (ln === "sp") {
      const spPr = child(el, "spPr");
      if (!spPr) return;
      const xfrm = getXfrm(spPr);
      if (!xfrm) return;
      const xPct = pct(xfrm.x + gx), yPct = pctH(xfrm.y + gy);
      const wPct = pct(xfrm.cx), hPct = pctH(xfrm.cy);
      const bc = shapeBackCss(spPr);
      const bcStr = cssText(bc);
      const txBody = child(el, "txBody");
      const inner = txBody ? buildTextHtml(txBody) : (child(spPr, "prstGeom") ? "&nbsp;" : "");
      stack.push(`<div style="position:absolute;left:${xPct}%;top:${yPct}%;width:${wPct}%;height:${hPct}%;box-sizing:border-box${bcStr ? ";" + bcStr : ""}">${inner}</div>`);
    } else if (ln === "pic") {
      const blipFill = child(el, "blipFill");
      if (!blipFill) return;
      const blip = child(blipFill, "blip");
      if (!blip) return;
      const ref = getREmbed(blip);
      if (!ref || !relsMap[ref] || !mediaUrls[relsMap[ref]]) return;
      const spPr = child(el, "spPr");
      if (!spPr) return;
      const xfrm = getXfrm(spPr);
      if (!xfrm) return;
      const xPct = pct(xfrm.x + gx), yPct = pctH(xfrm.y + gy);
      const wPct = pct(xfrm.cx), hPct = pctH(xfrm.cy);
      stack.push(`<img src="${mediaUrls[relsMap[ref]]}" style="position:absolute;left:${xPct}%;top:${yPct}%;width:${wPct}%;height:${hPct}%;object-fit:fill">`);
    }
  }

  const spTree = child(cSld, "spTree");
  if (spTree) {
    for (const el of spTree.children) {
      if (el.localName === "grpSp") {
        const grpSpPr = child(el, "grpSpPr");
        if (!grpSpPr) continue;
        const grpXfrm = getXfrm(grpSpPr);
        if (!grpXfrm) continue;
        for (const gc of el.children) posDiv(gc, grpXfrm.x, grpXfrm.y);
      } else {
        posDiv(el, 0, 0);
      }
    }
  }

  stack.push("</div>");
  return stack.join("\n");
}

export async function convertPptxToPdfPages(arrayBuffer, pdfDoc) {
  try {
    const JSZipLib = globalThis.JSZip;
    if (!JSZipLib) throw new Error("JSZip library is not available.");
    const size = await detectPptxPageSize(arrayBuffer);
    const pw = size ? size.width : 595.28;
    const ph = size ? size.height : 841.89;
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort();
    if (!slideFiles.length) throw new Error("No slides found in this presentation.");

    const mediaUrls = await loadMediaUrls(zip);

    const slideWEmu = size ? size.width * 12700 : 12192000;
    const slideHEmu = size ? size.height * 12700 : 6858000;
    const cssW = Math.round(ptToCss(pw));
    const cssH = Math.round(ptToCss(ph));

    for (const slidePath of slideFiles) {
      try {
        const slideNum = slidePath.match(/slide(\d+)\.xml$/)[1];
        const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
        const relsDoc = zip.files[relsPath] ? new DOMParser().parseFromString(await zip.files[relsPath].async("text"), "text/xml") : null;
        const relsMap = {};
        let layoutPath = null;
        if (relsDoc) {
          const relEls = relsDoc.getElementsByTagName("Relationship");
          for (const rel of relEls) {
            const id = rel.getAttribute("Id");
            const target = rel.getAttribute("Target");
            if (id && target) relsMap[id] = target.startsWith("../") ? target.replace("../", "ppt/") : "ppt/" + target;
            const type = rel.getAttribute("Type");
            if (type && type.includes("slideLayout") && target) layoutPath = target.startsWith("../") ? target.replace("../", "ppt/") : "ppt/" + target;
          }
        }

        let extraBg = "";
        if (layoutPath && zip.files[layoutPath]) {
          try {
            const lxml = await zip.files[layoutPath].async("text");
            const ldoc = new DOMParser().parseFromString(lxml, "text/xml");
            const lCSld = ldoc.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "cSld")[0] || child(ldoc.documentElement, "cSld");
            if (lCSld) {
              const lNum = layoutPath.match(/slideLayout(\d+)\.xml$/);
              if (lNum) {
                const lRelsPath = `ppt/slideLayouts/_rels/slideLayout${lNum[1]}.xml.rels`;
                const lRelsDoc = zip.files[lRelsPath] ? new DOMParser().parseFromString(await zip.files[lRelsPath].async("text"), "text/xml") : null;
                const lRelsMap = {};
                if (lRelsDoc) {
                  for (const r of lRelsDoc.getElementsByTagName("Relationship")) {
                    const id = r.getAttribute("Id");
                    const target = r.getAttribute("Target");
                    if (id && target) lRelsMap[id] = target.startsWith("../") ? target.replace("../", "ppt/") : "ppt/" + target;
                  }
                }
                extraBg = bgHtml(lCSld, lRelsMap, mediaUrls);
              }
            }
          } catch {}
        }

        const xml = await zip.files[slidePath].async("text");
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        const cSld = doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/presentationml/2006/main", "cSld")[0] || child(doc.documentElement, "cSld") || doc.querySelector("cSld");
        if (!cSld) continue;

        stripHiddenFlags(cSld);

        const slideHtml = extraBg + buildSlideHtml(cSld, slideWEmu, slideHEmu, cssW, cssH, relsMap, mediaUrls);
        await captureHtml(pdfDoc, slideHtml, pw, ph);
      } catch (err) {
        console.warn("Skipped slide:", slidePath, err.message);
      }
    }
  } catch (err) {
    throw new Error(`PPTX conversion error: ${err.message}`);
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
      const scale = Math.min(1, 1440 / Math.max(image.width, image.height));
      const pw = image.width * scale;
      const ph = image.height * scale;
      const page = output.addPage([pw, ph]);
      page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
    } else if (ext === "docx") {
      await convertDocxToPdfPages(await item.file.arrayBuffer(), output);
    } else if (ext === "xlsx") {
      await convertXlsxToPdfPages(await item.file.arrayBuffer(), output);
    } else if (ext === "pptx") {
      await convertPptxToPdfPages(await item.file.arrayBuffer(), output);
    }
  }
  return output.save();
}
