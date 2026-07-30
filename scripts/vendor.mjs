import { copyFile, mkdir } from "node:fs/promises";

const files = [
  ["node_modules/pdf-lib/dist/pdf-lib.esm.min.js", "vendor/pdf-lib/pdf-lib.esm.min.js"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "vendor/pdfjs/pdf.mjs"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "vendor/pdfjs/pdf.worker.mjs"],
  ["node_modules/mammoth/mammoth.browser.min.js", "vendor/mammoth/mammoth.browser.min.js"],
  ["node_modules/xlsx/xlsx.mjs", "vendor/xlsx/xlsx.mjs"],
  ["node_modules/jszip/dist/jszip.min.js", "vendor/jszip/jszip.min.js"],
];

for (const [source, destination] of files) {
  await mkdir(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
  await copyFile(source, destination);
}

console.log("Local browser libraries copied to vendor/.");
