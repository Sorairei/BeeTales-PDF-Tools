import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import fontkit from "@pdf-lib/fontkit";

globalThis.JSZip = JSZip;
globalThis.fontkit = fontkit;

import { PDFDocument } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { buildPdfFromPages, calculateWatermarkPlacement, createSplitPdfs, fitImageWithinPage, moveItem, PAPER_SIZES, parseHexColor, parsePageSelection, signatureWidthForPage, stampPdf } from "../core.mjs";

test("page selections accept ranges, spaces, and duplicates", () => {
  assert.deepEqual(parsePageSelection("1-3, 3, 5", 5), [0, 1, 2, 4]);
  assert.throws(() => parsePageSelection("6", 5), /outside/);
  assert.throws(() => parsePageSelection("4-2", 5), /backwards/);
  assert.throws(() => parsePageSelection("1-999999999", 5), /outside/);
});

test("items can be moved earlier or later without mutating the source list", () => {
  const source = ["first", "second", "third"];
  assert.deepEqual(moveItem(source, 2, 0), ["third", "first", "second"]);
  assert.deepEqual(moveItem(source, 0, 1), ["second", "first", "third"]);
  assert.deepEqual(moveItem(source, 0, -1), source);
  assert.deepEqual(source, ["first", "second", "third"]);
});

test("watermark colors are converted from hex to PDF RGB values", () => {
  assert.deepEqual(parseHexColor("#ff8000"), { red: 1, green: 128 / 255, blue: 0 });
  assert.throws(() => parseHexColor("purple"), /valid watermark color/);
});

test("watermarks can be placed at the top, center, or bottom", () => {
  const top = calculateWatermarkPlacement(600, 800, 220, 54, "top");
  const center = calculateWatermarkPlacement(600, 800, 220, 54, "center");
  const bottom = calculateWatermarkPlacement(600, 800, 220, 54, "bottom");
  assert.ok(top.y > center.y);
  assert.ok(center.y > bottom.y);
  assert.equal(bottom.y, 30);
});

test("tall signature images are fitted inside the PDF page", () => {
  const fitted = fitImageWithinPage(100, 2000, 600, 800, 150, 30);
  assert.ok(fitted.width <= 540);
  assert.ok(fitted.height <= 740);
  assert.equal(fitted.height, 740);
});

test("signature width stays proportional on small pages and capped on large pages", () => {
  assert.equal(signatureWidthForPage(300, 0.26), 78);
  assert.equal(signatureWidthForPage(2000, 0.34), 260);
  const tall = fitImageWithinPage(100, 2000, 300, 500, 78, 30, 0.34);
  assert.equal(tall.height, 170);
});

test("pages can be copied, reordered, and rotated", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  source.addPage([500, 600]);
  const bytes = await buildPdfFromPages(
    [{ document: source }],
    [
      { sourceIndex: 0, pageIndex: 1, rotation: 90 },
      { sourceIndex: 0, pageIndex: 0, rotation: 0 },
    ],
  );
  const result = await PDFDocument.load(bytes);
  assert.equal(result.getPageCount(), 2);
  assert.equal(result.getPage(0).getRotation().angle, 90);
});

test("page numbers are added without changing page count", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  source.addPage([300, 400]);
  const stamped = await stampPdf(await source.save(), { kind: "numbers", startAt: 1, position: "bottom-center" });
  const result = await PDFDocument.load(stamped);
  assert.equal(result.getPageCount(), 2);
});

test("selected pages can be split into independent PDFs", async () => {
  const source = await PDFDocument.create();
  source.addPage([300, 400]);
  source.addPage([500, 600]);
  const outputs = await createSplitPdfs(source, [0, 1]);
  assert.equal(outputs.length, 2);
  for (const bytes of outputs) assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});

test("PAPER_SIZES contains required formats with correct PDF-point dimensions", () => {
  assert.ok(PAPER_SIZES.a4, "a4 must exist");
  assert.equal(PAPER_SIZES.a4.width, 595.28);
  assert.equal(PAPER_SIZES.a4.height, 841.89);
  assert.ok(PAPER_SIZES.letter, "letter must exist");
  assert.equal(PAPER_SIZES.letter.width, 612);
  assert.ok(PAPER_SIZES.legal, "legal/oficio must exist");
  assert.equal(PAPER_SIZES.legal.height, 1008, "Oficio/Legal height must be 1008pt (14 in)");
  assert.ok(PAPER_SIZES.a3, "a3 must exist");
  assert.ok(PAPER_SIZES.a5, "a5 must exist");
  // ISO 216: A5 (148×210 mm) is half of A4 (210×297 mm) — verify dimensions are reasonable
  assert.ok(PAPER_SIZES.a5.width > 400 && PAPER_SIZES.a5.width < 430, "A5 width ~419pt");
  assert.ok(PAPER_SIZES.a5.height > 580 && PAPER_SIZES.a5.height < 610, "A5 height ~595pt");
  assert.ok(PAPER_SIZES.executive, "executive must exist");
  assert.ok(PAPER_SIZES.b5, "b5 must exist");
  assert.ok(PAPER_SIZES.tabloid, "tabloid must exist");
});

test("getVectorFont embeds metric-compatible TTF fonts with caching", async () => {
  const { getVectorFont } = await import("../font-manager.mjs");
  const doc = await PDFDocument.create();
  const calibriRegular = await getVectorFont(doc, "calibri", false, false);
  assert.ok(calibriRegular, "Calibri font should be embedded");
  const calibriBold = await getVectorFont(doc, "calibri", true, false);
  assert.ok(calibriBold, "Calibri Bold font should be embedded");

  // Verify caching returns same instance for same doc and key
  const cached = await getVectorFont(doc, "calibri", false, false);
  assert.equal(cached, calibriRegular, "FontManager should return cached PDFFont");

  const page = doc.addPage([400, 400]);
  page.drawText("Test Vector Text", { x: 50, y: 350, font: calibriRegular, size: 14 });
  const bytes = await doc.save();
  assert.ok(bytes.length > 0, "PDF document with vector font should be generated");
});

test("NumberingManager formats list counters and levels correctly", async () => {
  const { NumberingManager } = await import("../docx-engine.mjs");
  const numXml = `
    <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    </w:numbering>
  `;
  const manager = new NumberingManager(numXml);
  assert.equal(manager.getLabel("1", 0), "1. ");
  assert.equal(manager.getLabel("1", 0), "2. ");
  assert.equal(manager.getLabel("1", 1), "a) ");
});

test("StyleResolver computes 4-level style cascade", async () => {
  const { StyleResolver } = await import("../docx-engine.mjs");
  const stylesXml = `
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:docDefaults>
        <w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>
      </w:docDefaults>
      <w:style w:styleId="Normal">
        <w:pPr><w:jc w:val="left"/><w:spacing w:after="160"/></w:pPr>
      </w:style>
      <w:style w:styleId="Heading1">
        <w:basedOn w:val="Normal"/>
        <w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120"/></w:pPr>
      </w:style>
    </w:styles>
  `;
  const resolver = new StyleResolver(stylesXml);
  const headingProps = resolver.resolveParagraphProps("Heading1");
  assert.equal(headingProps.jc, "center", "Heading1 should inherit and override center alignment");
  assert.equal(headingProps.spaceBefore, 12, "Heading1 spaceBefore = 240/20 = 12pt");
  assert.equal(headingProps.spaceAfter, 6, "Heading1 spaceAfter = 120/20 = 6pt");
});

test("convertDocxNative creates pure vector PDF from document XML", async () => {
  const { convertDocxNative } = await import("../docx-engine.mjs");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const docXml = `
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr><w:jc w:val="center"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Titulo Nativo Vectorial</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>Este párrafo fue generado 100% nativo sin html2canvas.</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>
  `;
  zip.file("word/document.xml", docXml);
  const docxBytes = await zip.generateAsync({ type: "arraybuffer" });

  const pdfDoc = await PDFDocument.create();
  await convertDocxNative(docxBytes, pdfDoc, "a4", 36);
  assert.equal(pdfDoc.getPageCount(), 1, "PDF should contain 1 page");

  const pdfBytes = await pdfDoc.save();
  assert.ok(pdfBytes.length > 0, "PDF bytes should be successfully generated");
});

test("convertDocxNative renders 2-column document without overflowing to extra pages", async () => {
  const { convertDocxNative } = await import("../docx-engine.mjs");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const docXml = `
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:sectPr>
          <w:cols w:num="2" w:space="720"/>
        </w:sectPr>
        <w:p><w:r><w:t>Nombre del Interprete: Carlos Noe</w:t></w:r></w:p>
        <w:p><w:r><w:t>Genero: Bolero Ranchero</w:t></w:r></w:p>
        <w:p><w:r><w:br w:type="column"/></w:r></w:p>
        <w:p><w:r><w:t>Ese beso es el culpable</w:t></w:r></w:p>
      </w:body>
    </w:document>
  `;
  zip.file("word/document.xml", docXml);
  const docxBytes = await zip.generateAsync({ type: "arraybuffer" });

  const pdfDoc = await PDFDocument.create();
  await convertDocxNative(docxBytes, pdfDoc, "a4", 36);
  assert.equal(pdfDoc.getPageCount(), 1, "2-column layout with column break should stay on 1 single page");
});

