import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { buildPdfFromPages, calculateWatermarkPlacement, createSplitPdfs, fitImageWithinPage, moveItem, parseHexColor, parsePageSelection, signatureWidthForPage, stampPdf } from "../core.mjs";

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
