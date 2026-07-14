import { copyFile, mkdir } from "node:fs/promises";

const files = [
  ["node_modules/pdf-lib/dist/pdf-lib.esm.min.js", "vendor/pdf-lib/pdf-lib.esm.min.js"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "vendor/pdfjs/pdf.mjs"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "vendor/pdfjs/pdf.worker.mjs"],
];

for (const [source, destination] of files) {
  await mkdir(destination.slice(0, destination.lastIndexOf("/")), { recursive: true });
  await copyFile(source, destination);
}

console.log("Local browser libraries copied to vendor/.");
