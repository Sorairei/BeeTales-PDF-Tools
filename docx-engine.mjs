import { rgb } from "./vendor/pdf-lib/pdf-lib.esm.min.js";
import { getVectorFont } from "./font-manager.mjs";
import { PAPER_SIZES } from "./core.mjs";

async function getJSZip() {
  if (typeof globalThis !== "undefined" && globalThis.JSZip) return globalThis.JSZip;
  if (typeof window !== "undefined" && window.JSZip) return window.JSZip;
  try {
    const mod = await import("jszip");
    return mod.default || mod;
  } catch {
    return globalThis.JSZip;
  }
}

/** Convert twips (1/20 pt) to PDF points */
export function twipsToPt(twips) {
  return Number(twips || 0) / 20;
}

/** Convert EMUs (English Metric Units) to PDF points (1 pt = 12700 EMUs) */
export function emuToPt(emu) {
  return Number(emu || 0) / 12700;
}

/** Parse hex color string (e.g. "FF0000" or "auto") into pdf-lib rgb() */
export function parseColor(hex, defaultColor = rgb(0, 0, 0)) {
  if (!hex || hex === "auto" || hex.length < 6) return defaultColor;
  const clean = hex.replace("#", "").slice(0, 6);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return isNaN(r) || isNaN(g) || isNaN(b) ? defaultColor : rgb(r, g, b);
}

/** Numbering Manager for list formatting and counters */
export class NumberingManager {
  constructor(numberingXml = "") {
    this.abstractNums = new Map(); // id -> levelMap
    this.numMap = new Map(); // numId -> abstractNumId
    this.counters = new Map(); // "numId:ilvl" -> currentCount

    if (numberingXml) this._parse(numberingXml);
  }

  _parse(xml) {
    // Parse abstractNum definitions
    const absRegex = /<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/gi;
    let match;
    while ((match = absRegex.exec(xml)) !== null) {
      const block = match[0];
      const idMatch = block.match(/w:abstractNumId="([^"]+)"/);
      if (!idMatch) continue;
      const absId = idMatch[1];
      const levels = new Map();

      const lvlRegex = /<w:lvl\b[\s\S]*?<\/w:lvl>/gi;
      let lvlMatch;
      while ((lvlMatch = lvlRegex.exec(block)) !== null) {
        const lvlBlock = lvlMatch[0];
        const ilvlMatch = lvlBlock.match(/w:ilvl="([^"]+)"/);
        if (!ilvlMatch) continue;
        const ilvl = parseInt(ilvlMatch[1], 10);
        const startMatch = lvlBlock.match(/<w:start\s+w:val="(\d+)"/);
        const fmtMatch = lvlBlock.match(/<w:numFmt\s+w:val="([^"]+)"/);
        const txtMatch = lvlBlock.match(/<w:lvlText\s+w:val="([^"]+)"/);
        const indMatch = lvlBlock.match(/<w:ind\b([^/]*)\/?>/);

        let leftInd = 0, hangingInd = 0;
        if (indMatch) {
          const l = indMatch[1].match(/w:left="([-\d]+)"/);
          const h = indMatch[1].match(/w:hanging="([-\d]+)"/);
          if (l) leftInd = twipsToPt(l[1]);
          if (h) hangingInd = twipsToPt(h[1]);
        }

        levels.set(ilvl, {
          start: startMatch ? parseInt(startMatch[1], 10) : 1,
          numFmt: fmtMatch ? fmtMatch[1] : "decimal",
          lvlText: txtMatch ? txtMatch[1] : "%1.",
          leftInd,
          hangingInd,
        });
      }
      this.abstractNums.set(absId, levels);
    }

    // Parse num definitions (instances)
    const numRegex = /<w:num\b[\s\S]*?<\/w:num>/gi;
    while ((match = numRegex.exec(xml)) !== null) {
      const block = match[0];
      const nId = (block.match(/w:numId="([^"]+)"/) || [])[1];
      const abId = (block.match(/<w:abstractNumId\s+w:val="([^"]+)"/) || [])[1];
      if (nId && abId) this.numMap.set(nId, abId);
    }
  }

  getLabel(numId, ilvl = 0) {
    const abId = this.numMap.get(String(numId));
    if (!abId) return "• ";
    const levels = this.abstractNums.get(abId);
    if (!levels) return "• ";
    const lvl = levels.get(Number(ilvl)) || { numFmt: "bullet", lvlText: "•" };

    const key = `${numId}:${ilvl}`;
    let count = this.counters.get(key);
    if (count == null) {
      count = lvl.start;
    } else {
      count++;
    }
    this.counters.set(key, count);

    // Format counter
    let formatted = String(count);
    if (lvl.numFmt === "bullet") return "• ";
    if (lvl.numFmt === "lowerLetter") formatted = String.fromCharCode(96 + ((count - 1) % 26 + 1));
    else if (lvl.numFmt === "upperLetter") formatted = String.fromCharCode(64 + ((count - 1) % 26 + 1));
    else if (lvl.numFmt === "lowerRoman") formatted = toRoman(count).toLowerCase();
    else if (lvl.numFmt === "upperRoman") formatted = toRoman(count);

    return (lvl.lvlText || "%1.").replace(/%\d+/g, formatted) + " ";
  }
}

function toRoman(num) {
  const lookup = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
  let roman = "";
  let n = num;
  for (const i in lookup) {
    while (n >= lookup[i]) {
      roman += i;
      n -= lookup[i];
    }
  }
  return roman || "i";
}

/** Style Resolver implementing 4-level DOCX style cascade */
export class StyleResolver {
  constructor(stylesXml = "") {
    this.styles = new Map(); // styleId -> styleObject
    this.defaults = {
      fontFamily: "Calibri",
      fontSize: 11,
      color: "000000",
      lineSpacing: 1.15,
      spaceAfter: 8,
    };
    if (stylesXml) this._parse(stylesXml);
  }

  _parse(xml) {
    // Parse docDefaults
    const pDefMatch = xml.match(/<w:pPrDefault>([\s\S]*?)<\/w:pPrDefault>/);
    const rDefMatch = xml.match(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/);
    if (rDefMatch) {
      const sz = rDefMatch[1].match(/<w:sz\s+w:val="(\d+)"/);
      if (sz) this.defaults.fontSize = Number(sz[1]) / 2;
      const rf = rDefMatch[1].match(/<w:rFonts\s+[^>]*w:ascii="([^"]+)"/);
      if (rf) this.defaults.fontFamily = rf[1];
    }

    // Parse named styles
    const styleRegex = /<w:style\b[\s\S]*?<\/w:style>/gi;
    let match;
    while ((match = styleRegex.exec(xml)) !== null) {
      const block = match[0];
      const idMatch = block.match(/w:styleId="([^"]+)"/);
      if (!idMatch) continue;
      const id = idMatch[1];
      const basedOn = (block.match(/<w:basedOn\s+w:val="([^"]+)"/) || [])[1];

      const pPr = (block.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/) || [])[1] || "";
      const rPr = (block.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || "";

      // Alignment
      const jc = (pPr.match(/<w:jc\s+w:val="([^"]+)"/) || [])[1];

      // Spacing
      let spaceBefore = null, spaceAfter = null, lineSpacing = null;
      const spcMatch = pPr.match(/<w:spacing\b([^/]*)\/?>/);
      if (spcMatch) {
        const b = spcMatch[1].match(/w:before="(\d+)"/);
        const a = spcMatch[1].match(/w:after="(\d+)"/);
        const l = spcMatch[1].match(/w:line="(\d+)"/);
        const rule = (spcMatch[1].match(/w:lineRule="([^"]+)"/) || [])[1] || "auto";
        if (b) spaceBefore = twipsToPt(b[1]);
        if (a) spaceAfter = twipsToPt(a[1]);
        if (l) lineSpacing = rule === "auto" ? Number(l[1]) / 240 : twipsToPt(l[1]);
      }

      // Run formatting
      const isBold = /<w:b\/>|<w:b\s+w:val="1"/.test(rPr);
      const isItalic = /<w:i\/>|<w:i\s+w:val="1"/.test(rPr);
      const szMatch = rPr.match(/<w:sz\s+w:val="(\d+)"/);
      const fontSize = szMatch ? Number(szMatch[1]) / 2 : null;
      const colMatch = (rPr.match(/<w:color\s+w:val="([^"]+)"/) || [])[1];
      const fontMatch = (rPr.match(/<w:rFonts\s+[^>]*w:ascii="([^"]+)"/) || [])[1];

      this.styles.set(id, {
        id,
        basedOn,
        jc,
        spaceBefore,
        spaceAfter,
        lineSpacing,
        isBold,
        isItalic,
        fontSize,
        color: colMatch,
        fontFamily: fontMatch,
      });
    }
  }

  resolveParagraphProps(styleId, directPPr = "") {
    let jc = "left";
    let spaceBefore = 0;
    let spaceAfter = this.defaults.spaceAfter;
    let lineSpacing = this.defaults.lineSpacing;
    let leftInd = 0, rightInd = 0, firstLineInd = 0, hangingInd = 0;

    // Check style hierarchy: base styles apply first, specific child styles override
    const chain = [];
    let currentId = styleId;
    const visited = new Set();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const st = this.styles.get(currentId);
      if (st) chain.unshift(st);
      currentId = st ? st.basedOn : null;
    }

    for (const st of chain) {
      if (st.jc) jc = st.jc;
      if (st.spaceBefore != null) spaceBefore = st.spaceBefore;
      if (st.spaceAfter != null) spaceAfter = st.spaceAfter;
      if (st.lineSpacing != null) lineSpacing = st.lineSpacing;
    }

    // Apply direct paragraph formatting
    if (directPPr) {
      const djc = (directPPr.match(/<w:jc\s+w:val="([^"]+)"/) || [])[1];
      if (djc) jc = djc;

      const spcMatch = directPPr.match(/<w:spacing\b([^/]*)\/?>/);
      if (spcMatch) {
        const b = spcMatch[1].match(/w:before="(\d+)"/);
        const a = spcMatch[1].match(/w:after="(\d+)"/);
        const l = spcMatch[1].match(/w:line="(\d+)"/);
        const rule = (spcMatch[1].match(/w:lineRule="([^"]+)"/) || [])[1] || "auto";
        if (b) spaceBefore = twipsToPt(b[1]);
        if (a) spaceAfter = twipsToPt(a[1]);
        if (l) lineSpacing = rule === "auto" ? Number(l[1]) / 240 : twipsToPt(l[1]);
      }

      const indMatch = directPPr.match(/<w:ind\b([^/]*)\/?>/);
      if (indMatch) {
        const l = indMatch[1].match(/w:left="([-\d]+)"/);
        const r = indMatch[1].match(/w:right="([-\d]+)"/);
        const fl = indMatch[1].match(/w:firstLine="([-\d]+)"/);
        const hg = indMatch[1].match(/w:hanging="([-\d]+)"/);
        if (l) leftInd = twipsToPt(l[1]);
        if (r) rightInd = twipsToPt(r[1]);
        if (fl) firstLineInd = twipsToPt(fl[1]);
        if (hg) hangingInd = twipsToPt(hg[1]);
      }
    }

    return { jc, spaceBefore, spaceAfter, lineSpacing, leftInd, rightInd, firstLineInd, hangingInd };
  }
}

/** Complete native DOCX Parser */
export class DocxParser {
  constructor(arrayBuffer) {
    this.arrayBuffer = arrayBuffer;
  }

  async parse() {
    const JSZip = await getJSZip();
    if (!JSZip) throw new Error("JSZip is not available.");
    const zip = await JSZip.loadAsync(this.arrayBuffer);

    // Relationships (for image media)
    const relsMap = new Map();
    const relsFile = zip.files["word/_rels/document.xml.rels"];
    if (relsFile) {
      const relsXml = await relsFile.async("text");
      const relRegex = /<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/gi;
      let rMatch;
      while ((rMatch = relRegex.exec(relsXml)) !== null) {
        relsMap.set(rMatch[1], rMatch[2].replace(/^word\//, ""));
      }
    }

    // Numbering
    const numFile = zip.files["word/numbering.xml"];
    const numberingXml = numFile ? await numFile.async("text") : "";
    const numbering = new NumberingManager(numberingXml);

    // Styles
    const stylesFile = zip.files["word/styles.xml"];
    const stylesXml = stylesFile ? await stylesFile.async("text") : "";
    const styleResolver = new StyleResolver(stylesXml);

    // Document
    const docFile = zip.files["word/document.xml"];
    if (!docFile) throw new Error("Invalid DOCX: missing word/document.xml");
    const xml = await docFile.async("text");

    // Page layout
    let pageSize = { width: PAPER_SIZES.a4.width, height: PAPER_SIZES.a4.height };
    let margins = { top: 56.7, right: 42.5, bottom: 56.7, left: 85.05 };

    const szTag = xml.match(/<[^>]*pgSz[^>]*\/?>/i);
    if (szTag) {
      const w = szTag[0].match(/\bw:w\s*=\s*["'](\d+)["']/i);
      const h = szTag[0].match(/\bw:h\s*=\s*["'](\d+)["']/i);
      if (w && h) pageSize = { width: twipsToPt(w[1]), height: twipsToPt(h[1]) };
    }
    const marTag = xml.match(/<[^>]*pgMar[^>]*\/?>/i);
    if (marTag) {
      const t = marTag[0].match(/w:top\s*=\s*["'](\d+)["']/i);
      const r = marTag[0].match(/w:right\s*=\s*["'](\d+)["']/i);
      const b = marTag[0].match(/w:bottom\s*=\s*["'](\d+)["']/i);
      const l = marTag[0].match(/w:left\s*=\s*["'](\d+)["']/i);
      if (t && r && b && l) {
        margins = { top: twipsToPt(t[1]), right: twipsToPt(r[1]), bottom: twipsToPt(b[1]), left: twipsToPt(l[1]) };
      }
    }

    const bodyMatch = xml.match(/<w:body>([\s\S]*?)<\/w:body>/);
    const bodyXml = bodyMatch ? bodyMatch[1] : xml;

    // Parse top-level body elements (Paragraphs & Tables)
    const elements = [];
    const elemRegex = /<(w:p|w:tbl)\b[\s\S]*?<\/\1>/gi;
    let elemMatch;

    while ((elemMatch = elemRegex.exec(bodyXml)) !== null) {
      const block = elemMatch[0];
      const tag = elemMatch[1];

      if (tag === "w:p") {
        const p = this._parseParagraph(block, styleResolver, numbering, relsMap, zip);
        if (p) elements.push(p);
      } else if (tag === "w:tbl") {
        const tbl = this._parseTable(block, styleResolver, numbering, relsMap, zip);
        if (tbl) elements.push(tbl);
      }
    }

    return { pageSize, margins, elements, numbering, styleResolver };
  }

  _parseParagraph(pXml, styleResolver, numbering, relsMap, zip) {
    const pPrMatch = pXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[1] : "";
    const styleId = (pPr.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || "Normal";

    const props = styleResolver.resolveParagraphProps(styleId, pPr);
    const pageBreak = /<w:pageBreakBefore\/>|<w:pageBreakBefore\s+w:val="1"|<w:br\s+w:type="page"/i.test(pXml);

    // List item check
    const numId = (pPr.match(/<w:numId\s+w:val="([^"]+)"/) || [])[1];
    const ilvl = (pPr.match(/<w:ilvl\s+w:val="([^"]+)"/) || [])[1] || "0";
    let listPrefix = "";
    if (numId) {
      listPrefix = numbering.getLabel(numId, ilvl);
    }

    // Runs and images
    const runs = [];
    if (listPrefix) {
      runs.push({
        text: listPrefix,
        fontFamily: "Calibri",
        fontSize: 11,
        isBold: true,
        isItalic: false,
        color: "000000",
      });
    }

    const runRegex = /<w:r\b[\s\S]*?<\/w:r>/gi;
    let rMatch;
    while ((rMatch = runRegex.exec(pXml)) !== null) {
      const rBlock = rMatch[0];
      const rPr = (rBlock.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/) || [])[1] || "";

      const isBold = /<w:b\/>|<w:b\s+w:val="1"/.test(rPr);
      const isItalic = /<w:i\/>|<w:i\s+w:val="1"/.test(rPr);
      const szMatch = rPr.match(/<w:sz\s+w:val="(\d+)"/);
      const fontSize = szMatch ? Number(szMatch[1]) / 2 : 11;
      const color = (rPr.match(/<w:color\s+w:val="([^"]+)"/) || [])[1] || "000000";
      const fontMatch = (rPr.match(/<w:rFonts\s+[^>]*w:ascii="([^"]+)"/) || [])[1] || "Calibri";

      // Text parts
      const tRegex = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/gi;
      let tMatch;
      while ((tMatch = tRegex.exec(rBlock)) !== null) {
        const rawText = tMatch[2];
        const text = rawText
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");

        if (text) {
          runs.push({
            text,
            fontFamily: fontMatch,
            fontSize,
            isBold,
            isItalic,
            color,
          });
        }
      }

      // Check for drawing image inside run
      const blipMatch = rBlock.match(/<a:blip\s+[^>]*r:embed="([^"]+)"/);
      const extMatch = rBlock.match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/);
      if (blipMatch) {
        const rId = blipMatch[1];
        const targetPath = relsMap.get(rId);
        if (targetPath) {
          const zipPath = targetPath.startsWith("media/") ? `word/${targetPath}` : `word/${targetPath}`;
          const file = zip.files[zipPath] || zip.files[targetPath];
          if (file) {
            const widthPt = extMatch ? emuToPt(extMatch[1]) : 200;
            const heightPt = extMatch ? emuToPt(extMatch[2]) : 150;
            runs.push({
              type: "image",
              file,
              widthPt,
              heightPt,
            });
          }
        }
      }
    }

    return {
      type: "paragraph",
      props,
      runs,
      pageBreak,
    };
  }

  _parseTable(tblXml, styleResolver, numbering, relsMap, zip) {
    const rows = [];
    const trRegex = /<w:tr\b[\s\S]*?<\/w:tr>/gi;
    let trMatch;

    while ((trMatch = trRegex.exec(tblXml)) !== null) {
      const trBlock = trMatch[0];
      const cells = [];
      const tcRegex = /<w:tc\b[\s\S]*?<\/w:tc>/gi;
      let tcMatch;

      while ((tcMatch = tcRegex.exec(trBlock)) !== null) {
        const tcBlock = tcMatch[0];
        const tcPr = (tcBlock.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/) || [])[1] || "";
        const wMatch = tcPr.match(/<w:tcW\s+w:w="(\d+)"/);
        const widthPt = wMatch ? twipsToPt(wMatch[1]) : 100;
        const shdMatch = tcPr.match(/<w:shd\s+[^>]*w:fill="([^"]+)"/);
        const bgColor = shdMatch ? shdMatch[1] : null;

        // Parse paragraphs inside cell
        const paragraphs = [];
        const pRegex = /<w:p\b[\s\S]*?<\/w:p>/gi;
        let pMatch;
        while ((pMatch = pRegex.exec(tcBlock)) !== null) {
          const p = this._parseParagraph(pMatch[0], styleResolver, numbering, relsMap, zip);
          if (p) paragraphs.push(p);
        }

        cells.push({
          widthPt,
          bgColor,
          paragraphs,
        });
      }

      rows.push({ cells });
    }

    return {
      type: "table",
      rows,
    };
  }
}

/** Complete Native Direct DOCX to pdf-lib Renderer */
export class DocxRenderer {
  constructor(pdfDoc, parsedDoc, options = {}) {
    this.pdfDoc = pdfDoc;
    this.parsed = parsedDoc;
    this.options = options;

    const paperKey = options.paperKey || "auto";
    const forcedPaper = PAPER_SIZES[paperKey];

    this.pw = forcedPaper ? forcedPaper.width : parsedDoc.pageSize.width;
    this.ph = forcedPaper ? forcedPaper.height : parsedDoc.pageSize.height;

    const marginPt = options.marginPt != null ? options.marginPt : null;
    this.topMargin = marginPt != null && marginPt >= 0 ? marginPt : parsedDoc.margins.top;
    this.bottomMargin = marginPt != null && marginPt >= 0 ? marginPt : parsedDoc.margins.bottom;
    this.leftMargin = marginPt != null && marginPt >= 0 ? marginPt : parsedDoc.margins.left;
    this.rightMargin = marginPt != null && marginPt >= 0 ? marginPt : parsedDoc.margins.right;

    this.printableWidth = Math.max(50, this.pw - this.leftMargin - this.rightMargin);
    this.currentPage = null;
    this.currentY = 0;
  }

  _newPage() {
    this.currentPage = this.pdfDoc.addPage([this.pw, this.ph]);
    this.currentY = this.ph - this.topMargin;
    return this.currentPage;
  }

  async render() {
    this._newPage();

    for (const elem of this.parsed.elements) {
      if (elem.type === "paragraph") {
        await this._renderParagraph(elem);
      } else if (elem.type === "table") {
        await this._renderTable(elem);
      }
    }

    return true;
  }

  async _renderParagraph(p) {
    if (p.pageBreak) {
      this._newPage();
    }

    const { jc = "left", spaceBefore = 0, spaceAfter = 6, lineSpacing = 1.15, leftInd = 0, rightInd = 0, firstLineInd = 0, hangingInd = 0 } = p.props;

    // Apply space before
    this.currentY -= spaceBefore;

    const effLeft = this.leftMargin + leftInd;
    const effWidth = Math.max(50, this.printableWidth - leftInd - rightInd);

    // If paragraph has embedded images
    const imageRuns = p.runs.filter((r) => r.type === "image");
    for (const imgRun of imageRuns) {
      const bytes = await imgRun.file.async("uint8array");
      let embeddedImg;
      try {
        embeddedImg = await this.pdfDoc.embedPng(bytes);
      } catch {
        embeddedImg = await this.pdfDoc.embedJpg(bytes);
      }

      const drawW = Math.min(effWidth, imgRun.widthPt);
      const drawH = (imgRun.heightPt / imgRun.widthPt) * drawW;

      if (this.currentY - drawH < this.bottomMargin) {
        this._newPage();
      }

      this.currentPage.drawImage(embeddedImg, {
        x: effLeft,
        y: this.currentY - drawH,
        width: drawW,
        height: drawH,
      });

      this.currentY -= drawH + spaceAfter;
      return;
    }

    // Text runs
    const words = [];
    for (const run of p.runs) {
      const font = await getVectorFont(this.pdfDoc, run.fontFamily, run.isBold, run.isItalic);
      const tokens = run.text.split(/(\s+)/);
      for (const token of tokens) {
        if (!token) continue;
        words.push({
          text: token,
          font,
          fontSize: run.fontSize,
          color: parseColor(run.color),
          isSpace: /^\s+$/.test(token),
        });
      }
    }

    // Line wrapping with exact font metrics
    const lines = [];
    let currentLine = [];
    let currentLineWidth = 0;
    let isFirstLine = true;
    let activeWidth = isFirstLine ? effWidth - firstLineInd + hangingInd : effWidth;

    for (const word of words) {
      const wordWidth = word.font.widthOfTextAtSize(word.text, word.fontSize);
      if (currentLineWidth + wordWidth > activeWidth && currentLine.length > 0 && !word.isSpace) {
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
        isFirstLine = false;
        activeWidth = effWidth;
      }
      if (currentLine.length === 0 && word.isSpace) continue;
      currentLine.push(word);
      currentLineWidth += wordWidth;
    }
    if (currentLine.length) lines.push(currentLine);

    const baseFontSize = p.runs[0] ? p.runs[0].fontSize : 11;
    const lineHeight = baseFontSize * Math.max(1.1, lineSpacing);

    if (!lines.length) {
      // Empty line (blank paragraph)
      this.currentY -= lineHeight;
      if (this.currentY < this.bottomMargin) this._newPage();
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (this.currentY - lineHeight < this.bottomMargin) {
        this._newPage();
      }

      let lineTotalW = 0;
      for (const w of line) lineTotalW += w.font.widthOfTextAtSize(w.text, w.fontSize);

      let startX = effLeft;
      if (i === 0 && firstLineInd > 0) startX += firstLineInd;
      if (i === 0 && hangingInd > 0) startX -= hangingInd;

      if (jc === "center") {
        startX = effLeft + Math.max(0, (effWidth - lineTotalW) / 2);
      } else if (jc === "right") {
        startX = effLeft + Math.max(0, effWidth - lineTotalW);
      }

      let curX = startX;
      for (const word of line) {
        this.currentPage.drawText(word.text, {
          x: curX,
          y: this.currentY - word.fontSize,
          font: word.font,
          size: word.fontSize,
          color: word.color,
        });
        curX += word.font.widthOfTextAtSize(word.text, word.fontSize);
      }

      this.currentY -= lineHeight;
    }

    // Apply space after
    this.currentY -= spaceAfter;
  }

  async _renderTable(table) {
    for (const row of table.rows) {
      // Calculate row height based on cell content
      let maxCellHeight = 24;
      for (const cell of row.cells) {
        let cellH = 10;
        for (const p of cell.paragraphs) {
          const fontSize = p.runs[0] ? p.runs[0].fontSize : 10;
          cellH += (p.runs.length ? fontSize * 1.3 : 14) + 4;
        }
        if (cellH > maxCellHeight) maxCellHeight = cellH;
      }

      if (this.currentY - maxCellHeight < this.bottomMargin) {
        this._newPage();
      }

      let cellX = this.leftMargin;
      for (const cell of row.cells) {
        const cellW = Math.min(this.printableWidth, cell.widthPt || 120);

        // Fill background if specified
        if (cell.bgColor && cell.bgColor !== "auto") {
          this.currentPage.drawRectangle({
            x: cellX,
            y: this.currentY - maxCellHeight,
            width: cellW,
            height: maxCellHeight,
            color: parseColor(cell.bgColor),
          });
        }

        // Draw cell border
        this.currentPage.drawRectangle({
          x: cellX,
          y: this.currentY - maxCellHeight,
          width: cellW,
          height: maxCellHeight,
          borderWidth: 0.5,
          borderColor: rgb(0.7, 0.7, 0.7),
        });

        // Draw cell text
        let innerY = this.currentY - 6;
        for (const p of cell.paragraphs) {
          for (const run of p.runs) {
            const font = await getVectorFont(this.pdfDoc, run.fontFamily, run.isBold, run.isItalic);
            this.currentPage.drawText(run.text, {
              x: cellX + 4,
              y: innerY - run.fontSize,
              font,
              size: run.fontSize,
              color: parseColor(run.color),
            });
          }
          innerY -= 14;
        }

        cellX += cellW;
      }

      this.currentY -= maxCellHeight;
    }

    this.currentY -= 8; // table bottom margin
  }
}

/** Entry point for complete native direct DOCX to PDF conversion */
export async function convertDocxNative(arrayBuffer, pdfDoc, paperKey = "auto", marginPt = null) {
  const parser = new DocxParser(arrayBuffer);
  const parsed = await parser.parse();
  const renderer = new DocxRenderer(pdfDoc, parsed, { paperKey, marginPt });
  return renderer.render();
}
