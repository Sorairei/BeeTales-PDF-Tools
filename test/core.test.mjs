import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "../vendor/pdf-lib/pdf-lib.esm.min.js";
import { buildPdfFromPages, parseHexColor, parsePageSelection, stampPdf } from "../core.mjs";

test("page selections accept ranges, spaces, and duplicates", () => {
  assert.deepEqual(parsePageSelection("1-3, 3, 5", 5), [0, 1, 2, 4]);
  assert.throws(() => parsePageSelection("6", 5), /outside/);
  assert.throws(() => parsePageSelection("4-2", 5), /backwards/);
});

test("watermark colors are converted from hex to PDF RGB values", () => {
  assert.deepEqual(parseHexColor("#ff8000"), { red: 1, green: 128 / 255, blue: 0 });
  assert.throws(() => parseHexColor("purple"), /valid watermark color/);
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
