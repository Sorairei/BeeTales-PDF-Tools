import { copyFile, mkdir, cp } from "node:fs/promises";

const files = [
  ["node_modules/pdf-lib/dist/pdf-lib.esm.min.js", "vendor/pdf-lib/pdf-lib.esm.min.js"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "vendor/pdfjs/pdf.mjs"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "vendor/pdfjs/pdf.worker.mjs"],
  ["node_modules/mammoth/mammoth.browser.min.js", "vendor/mammoth/mammoth.browser.min.js"],
  ["node_modules/xlsx/xlsx.mjs", "vendor/xlsx/xlsx.mjs"],
  ["node_modules/jszip/dist/jszip.min.js", "vendor/jszip/jszip.min.js"],
  ["node_modules/html2canvas/dist/html2canvas.esm.js", "vendor/html2canvas/html2canvas.esm.js"],
  // pptx-browser: zero-dep Canvas-based PPTX renderer
];

for (const [source, destination] of files) {
  await mkdir(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
  await copyFile(source, destination);
}

// pptx-browser: copy entire src/ directory
await mkdir("vendor/pptx-browser", { recursive: true });
await cp("node_modules/pptx-browser/src", "vendor/pptx-browser", { recursive: true });

console.log("Local browser libraries copied to vendor/.");
