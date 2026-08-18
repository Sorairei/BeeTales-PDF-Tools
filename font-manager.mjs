import { StandardFonts } from "./vendor/pdf-lib/pdf-lib.esm.min.js";

async function getFontkit() {
  if (typeof globalThis !== "undefined" && globalThis.fontkit) return globalThis.fontkit;
  if (typeof window !== "undefined" && window.fontkit) return window.fontkit;
  try {
    const mod = await import("@pdf-lib/fontkit");
    return mod.default || mod;
  } catch {
    return globalThis.fontkit || null;
  }
}

const FONT_MAP = {
  // Calibri -> Carlito
  "calibri_400_normal": "carlito-400-normal.ttf",
  "calibri_700_normal": "carlito-700-normal.ttf",
  "calibri_400_italic": "carlito-400-italic.ttf",
  "calibri_700_italic": "carlito-700-italic.ttf",
  "carlito_400_normal": "carlito-400-normal.ttf",
  "carlito_700_normal": "carlito-700-normal.ttf",
  "carlito_400_italic": "carlito-400-italic.ttf",
  "carlito_700_italic": "carlito-700-italic.ttf",

  // Arial -> Arimo
  "arial_400_normal": "arimo-400-normal.ttf",
  "arial_700_normal": "arimo-700-normal.ttf",
  "arial_400_italic": "arimo-400-italic.ttf",
  "arial_700_italic": "arimo-700-italic.ttf",
  "arimo_400_normal": "arimo-400-normal.ttf",
  "arimo_700_normal": "arimo-700-normal.ttf",
  "arimo_400_italic": "arimo-400-italic.ttf",
  "arimo_700_italic": "arimo-700-italic.ttf",

  // Times New Roman -> Tinos
  "times new roman_400_normal": "tinos-400-normal.ttf",
  "times new roman_700_normal": "tinos-700-normal.ttf",
  "times new roman_400_italic": "tinos-400-italic.ttf",
  "times new roman_700_italic": "tinos-700-italic.ttf",
  "tinos_400_normal": "tinos-400-normal.ttf",
  "tinos_700_normal": "tinos-700-normal.ttf",
  "tinos_400_italic": "tinos-400-italic.ttf",
  "tinos_700_italic": "tinos-700-italic.ttf",

  // Courier New -> Cousine
  "courier new_400_normal": "cousine-400-normal.ttf",
  "courier new_700_normal": "cousine-700-normal.ttf",
  "courier new_400_italic": "cousine-400-italic.ttf",
  "courier new_700_italic": "cousine-700-italic.ttf",
  "cousine_400_normal": "cousine-400-normal.ttf",
  "cousine_700_normal": "cousine-700-normal.ttf",
  "cousine_400_italic": "cousine-400-italic.ttf",
  "cousine_700_italic": "cousine-700-italic.ttf",
};

// Global in-memory cache for downloaded TTF ArrayBuffers
const rawFontCache = new Map();

// Per-PDFDocument cache for embedded PDFFont objects
const docFontCache = new WeakMap();

async function fetchFontBuffer(fileName) {
  if (rawFontCache.has(fileName)) return rawFontCache.get(fileName);

  let bytes;
  if (typeof window !== "undefined" && window.fetch) {
    const res = await fetch(`./vendor/fonts/${fileName}`);
    if (!res.ok) throw new Error(`Failed to load font ./vendor/fonts/${fileName}`);
    bytes = await res.arrayBuffer();
  } else {
    // Node.js environment (for unit testing)
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const buf = await fs.readFile(path.resolve("vendor/fonts", fileName));
    bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  rawFontCache.set(fileName, bytes);
  return bytes;
}

/**
 * Embed and return a vector PDFFont for the specified typography.
 * Caches embedded fonts per PDFDocument so fonts are only embedded once per PDF.
 */
export async function getVectorFont(pdfDoc, family = "calibri", isBold = false, isItalic = false) {
  const normFamily = String(family || "calibri").toLowerCase().trim();
  const weight = isBold ? "700" : "400";
  const style = isItalic ? "italic" : "normal";
  const key = `${normFamily}_${weight}_${style}`;

  // Check document-level cache
  let docCache = docFontCache.get(pdfDoc);
  if (!docCache) {
    docCache = new Map();
    docFontCache.set(pdfDoc, docCache);
  }
  if (docCache.has(key)) return docCache.get(key);

  // Register fontkit on this document if not already registered
  try {
    const fk = await getFontkit();
    if (fk) pdfDoc.registerFontkit(fk);
  } catch {}

  const fileName = FONT_MAP[key] || FONT_MAP[`calibri_${weight}_${style}`];
  if (fileName) {
    try {
      const buffer = await fetchFontBuffer(fileName);
      const font = await pdfDoc.embedFont(buffer);
      docCache.set(key, font);
      return font;
    } catch (err) {
      console.warn(`[BeeTales] Failed embedding vector font ${fileName}, falling back to StandardFonts:`, err);
    }
  }

  // Fallback to standard PDF fonts
  let fallbackName = StandardFonts.Helvetica;
  if (normFamily.includes("times")) {
    fallbackName = isBold && isItalic ? StandardFonts.TimesRomanBoldItalic
      : isBold ? StandardFonts.TimesRomanBold
      : isItalic ? StandardFonts.TimesRomanItalic
      : StandardFonts.TimesRoman;
  } else if (normFamily.includes("courier")) {
    fallbackName = isBold && isItalic ? StandardFonts.CourierBoldOblique
      : isBold ? StandardFonts.CourierBold
      : isItalic ? StandardFonts.CourierOblique
      : StandardFonts.Courier;
  } else {
    fallbackName = isBold && isItalic ? StandardFonts.HelveticaBoldOblique
      : isBold ? StandardFonts.HelveticaBold
      : isItalic ? StandardFonts.HelveticaOblique
      : StandardFonts.Helvetica;
  }

  const standardFont = await pdfDoc.embedFont(fallbackName);
  docCache.set(key, standardFont);
  return standardFont;
}
