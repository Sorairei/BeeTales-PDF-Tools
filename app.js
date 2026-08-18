import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";
import { PDFDocument } from "./vendor/pdf-lib/pdf-lib.esm.min.js";
import { buildMixedPdf, buildPdfFromPages, createSplitPdfs, moveItem, parsePageSelection, safePdfName, stampPdf } from "./core.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;

const elements = {
  form: document.querySelector("#tool-form"), modeInputs: [...document.querySelectorAll('input[name="mode"]')],
  input: document.querySelector("#file-input"), dropZone: document.querySelector("#drop-zone"), dropTitle: document.querySelector("#drop-title"), dropHint: document.querySelector("#drop-hint"),
  fileCard: document.querySelector("#file-card"), fileSummary: document.querySelector("#file-summary"), fileSize: document.querySelector("#file-size"), clear: document.querySelector("#clear-files"),
  pagesSection: document.querySelector("#pages-section"), pagesTitle: document.querySelector("#pages-title"), pagesCount: document.querySelector("#pages-count"), pagesHelp: document.querySelector("#pages-help"), pageGrid: document.querySelector("#page-grid"),
  extractSettings: document.querySelector("#extract-settings"), imageSettings: document.querySelector("#image-settings"), stampSettings: document.querySelector("#stamp-settings"),
  pageSelection: document.querySelector("#page-selection"), selectionHelp: document.querySelector("#selection-help"), pageSize: document.querySelector("#page-size"), imageMargin: document.querySelector("#image-margin"),
  process: document.querySelector("#process-button"), results: document.querySelector("#results-panel"), resultsTitle: document.querySelector("#results-title"), resultsList: document.querySelector("#results-list"),
  progress: document.querySelector("#progress-bar"), status: document.querySelector("#status-message"), error: document.querySelector("#error-message"), reset: document.querySelector("#reset-button"),
  numberOptions: document.querySelector("#number-options"), watermarkOptions: document.querySelector("#watermark-options"), signatureOptions: document.querySelector("#signature-options"),
  signatureInput: document.querySelector("#signature-input"), signatureLabel: document.querySelector("#signature-label"),
};

const modeConfig = {
  organize: { accept: "application/pdf,.pdf", multiple: true, title: "Select one or more PDF files", hint: "Drag files here to merge them, then arrange their pages", button: "Create organized PDF", idle: "Choose a PDF to get started." },
  extract: { accept: "application/pdf,.pdf", multiple: false, title: "Select one PDF file", hint: "Then choose the pages you want to extract, remove, or split", button: "Process selected pages", idle: "Choose a PDF to select its pages." },
  images: { accept: "image/png,image/jpeg,.png,.jpg,.jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx", multiple: true, title: "Select images or Office documents", hint: "Drag files here, then arrange them into one PDF", button: "Create PDF from files", idle: "Choose images or Office documents to get started." },
  stamp: { accept: "application/pdf,.pdf", multiple: false, title: "Select one PDF file", hint: "Add page numbers, a watermark, or your signature", button: "Apply to PDF", idle: "Choose a PDF to add something to it." },
};

let mode = "organize";
let sources = [];
let pageItems = [];
let imageItems = [];
let resultUrls = [];
let draggedId = null;
let signatureFile = null;
let signaturePreviewUrl = null;
let loadGeneration = 0;
let isProcessing = false;
const activeLoadingTasks = new Set();

function bytesLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function setStatus(message, progress = 0) { elements.status.textContent = message; elements.progress.style.width = `${progress}%`; }
function showError(error) { elements.error.textContent = error instanceof Error ? error.message : String(error); elements.error.classList.remove("is-hidden"); }
function clearError() { elements.error.textContent = ""; elements.error.classList.add("is-hidden"); }
function activeValue(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function revokeResults() { resultUrls.forEach(URL.revokeObjectURL); resultUrls = []; elements.resultsList.replaceChildren(); elements.results.classList.add("is-hidden"); }
function setProcessingBusy(busy) {
  isProcessing = busy;
  elements.process.disabled = busy;
  elements.reset.disabled = busy;
  elements.clear.disabled = busy;
  elements.input.disabled = busy;
  elements.modeInputs.forEach((input) => { input.disabled = busy; });
}
function revokeSignaturePreview() {
  if (signaturePreviewUrl) URL.revokeObjectURL(signaturePreviewUrl);
  signaturePreviewUrl = null;
}

async function disposeLoaded(sourceList = [], images = []) {
  await Promise.allSettled(sourceList.map((source) => source.preview?.destroy?.()));
  images.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url); });
}

async function cancelActiveLoads() {
  const tasks = [...activeLoadingTasks];
  activeLoadingTasks.clear();
  await Promise.allSettled(tasks.map((task) => task.destroy()));
}

async function destroySources() {
  const previousSources = sources;
  const previousImages = imageItems;
  sources = []; pageItems = []; imageItems = [];
  await disposeLoaded(previousSources, previousImages);
}

async function resetWorkspace({ keepMode = true } = {}) {
  loadGeneration += 1;
  await cancelActiveLoads();
  await destroySources(); revokeResults(); clearError(); signatureFile = null; revokeSignaturePreview();
  if (!keepMode) elements.form.reset();
  elements.signatureInput.value = ""; elements.signatureLabel.textContent = "Choose a PNG or JPG signature";
  elements.input.value = ""; elements.pageSelection.value = ""; elements.pageGrid.replaceChildren(); elements.fileCard.classList.add("is-hidden"); elements.pagesSection.classList.add("is-hidden");
  if (!keepMode) mode = activeValue("mode") || "organize";
  elements.resultsTitle.textContent = "Your PDF is ready";
  syncOptionPanels();
  applyMode();
}

function syncOptionPanels() {
  const extractAction = activeValue("extract-action") || "extract";
  const extractCopy = { extract: "Enter the pages to keep in a new PDF.", remove: "Enter the pages to remove from the PDF.", split: "Enter the pages that should become separate PDF files." };
  elements.selectionHelp.textContent = extractCopy[extractAction];
  const stampKind = activeValue("stamp-kind") || "numbers";
  elements.numberOptions.classList.toggle("is-hidden", stampKind !== "numbers");
  elements.watermarkOptions.classList.toggle("is-hidden", stampKind !== "watermark");
  elements.signatureOptions.classList.toggle("is-hidden", stampKind !== "signature");
  document.querySelector("#watermark-color-value").textContent = document.querySelector("#watermark-color").value.toUpperCase();
  updateStampPreviews();
}

function updateStampPreviews() {
  const overlays = [...elements.pageGrid.querySelectorAll(".page-stamp-overlay")];
  overlays.forEach((overlay) => overlay.replaceChildren());
  if (mode !== "stamp" || !overlays.length) return;
  const kind = activeValue("stamp-kind") || "numbers";

  overlays.forEach((overlay, index) => {
    if (kind === "numbers") {
      const startAt = Number(document.querySelector("#number-start").value);
      const number = document.createElement("span");
      number.className = `stamp-number stamp-${document.querySelector("#number-position").value}`;
      number.textContent = String(index + (Number.isFinite(startAt) ? startAt : 1));
      overlay.append(number);
      return;
    }

    if (kind === "watermark") {
      const text = document.querySelector("#watermark-text").value.trim();
      if (!text) return;
      const position = document.querySelector("#watermark-position").value;
      const color = document.querySelector("#watermark-color").value;
      const opacity = Number(document.querySelector("#watermark-opacity").value);
      const previewOpacity = Math.min(.7, Math.max(.32, opacity * 2));
      const size = Number(document.querySelector("#watermark-size").value);
      const previewSize = Math.max(.58, Math.min(1.05, size / 66));
      if (position === "full") {
        const pattern = document.createElement("div");
        pattern.className = "stamp-watermark-pattern";
        pattern.style.color = color;
        pattern.style.opacity = String(previewOpacity);
        pattern.style.setProperty("--preview-watermark-size", `${Math.max(.48, previewSize * .68)}rem`);
        for (let item = 0; item < 10; item += 1) { const label = document.createElement("span"); label.textContent = text; pattern.append(label); }
        overlay.append(pattern);
      } else {
        const watermark = document.createElement("span");
        watermark.className = `stamp-watermark stamp-watermark-${position}`;
        watermark.textContent = text;
        watermark.style.color = color;
        watermark.style.opacity = String(previewOpacity);
        watermark.style.setProperty("--preview-watermark-size", `${previewSize}rem`);
        overlay.append(watermark);
      }
      return;
    }

    const signaturePage = Math.max(1, Number(document.querySelector("#signature-page").value) || 1);
    const showOnPage = document.querySelector("#signature-all").checked || signaturePage === index + 1;
    if (signaturePreviewUrl && showOnPage) {
      const signature = document.createElement("img");
      signature.className = `stamp-signature stamp-${document.querySelector("#signature-position").value}`;
      signature.src = signaturePreviewUrl;
      signature.alt = "";
      signature.style.width = `${Number(document.querySelector("#signature-size").value) * 100}%`;
      overlay.append(signature);
    }
  });
}

function applyMode() {
  const config = modeConfig[mode];
  elements.input.accept = config.accept; elements.input.multiple = config.multiple; elements.dropTitle.textContent = config.title; elements.dropHint.textContent = config.hint; elements.process.textContent = config.button;
  elements.extractSettings.classList.toggle("is-hidden", mode !== "extract"); elements.imageSettings.classList.toggle("is-hidden", mode !== "images"); elements.stampSettings.classList.toggle("is-hidden", mode !== "stamp");
  setStatus(config.idle, 0); clearError();
}

const OFFICE_TYPES = ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"];
const OFFICE_EXTS = /\.(docx|xlsx|pptx)$/i;

function validFiles(files) {
  const list = [...files];
  if (!list.length) return [];
  if (mode === "images") {
    const valid = list.filter((file) => ["image/png", "image/jpeg"].includes(file.type) || /\.(png|jpe?g)$/i.test(file.name) || OFFICE_TYPES.includes(file.type) || OFFICE_EXTS.test(file.name));
    if (valid.length !== list.length) throw new Error("Please choose only images (PNG, JPG) or Office documents (DOCX, XLSX, PPTX).");
    return valid;
  }
  const valid = list.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  if (valid.length !== list.length) throw new Error("Please choose PDF files only.");
  return mode === "organize" ? valid : valid.slice(0, 1);
}

async function loadFiles(fileList) {
  if (isProcessing) return;
  const requestedMode = mode;
  let files;
  try {
    files = validFiles(fileList);
  } catch (error) {
    showError(error);
    return;
  }
  if (!files.length) return;
  const requestId = ++loadGeneration;
  clearError(); revokeResults(); elements.process.disabled = true; setStatus(`Opening ${files.length} local ${files.length === 1 ? "file" : "files"}…`, 12);
  await cancelActiveLoads();
  await destroySources();
  elements.pageGrid.replaceChildren();
  let loaded = null;
  try {
    loaded = requestedMode === "images" ? loadImages(files) : await loadPdfs(files);
    if (requestId !== loadGeneration || requestedMode !== mode) {
      await disposeLoaded(loaded.sources, loaded.imageItems);
      return;
    }
    sources = loaded.sources;
    pageItems = loaded.pageItems;
    imageItems = loaded.imageItems;
    elements.pagesTitle.textContent = requestedMode === "images" ? "Arrange files" : requestedMode === "organize" ? "Arrange pages" : "Document preview";
    elements.pagesHelp.textContent = requestedMode === "images" ? "Drag files or use the arrow buttons to set their PDF order." : requestedMode === "organize" ? "Drag pages or use the arrow buttons to reorder them. You can also rotate or remove pages." : "Use this preview to identify the page numbers you need.";
    elements.fileCard.classList.remove("is-hidden"); elements.pagesSection.classList.remove("is-hidden");
    elements.fileSummary.textContent = files.length === 1 ? files[0].name : `${files.length} files selected`;
    elements.fileSize.textContent = `${pageItems.length || imageItems.length} ${requestedMode === "images" ? "files" : "pages"} · ${bytesLabel(files.reduce((sum, file) => sum + file.size, 0))}`;
    await renderItems(requestId);
    if (requestId !== loadGeneration) return;
    setStatus("Ready. Review your pages, then create the result.", 0);
  } catch (error) {
    if (requestId === loadGeneration && requestedMode === mode) {
      await destroySources(); elements.fileCard.classList.add("is-hidden"); elements.pagesSection.classList.add("is-hidden"); showError(error); setStatus(modeConfig[mode].idle, 0);
    }
  } finally {
    if (requestId === loadGeneration) elements.process.disabled = false;
  }
}

async function loadPdfs(files) {
  const loadedSources = [];
  const loadedPages = [];
  try {
    for (let sourceIndex = 0; sourceIndex < files.length; sourceIndex += 1) {
      const file = files[sourceIndex]; const bytes = new Uint8Array(await file.arrayBuffer());
      let document;
      try { document = await PDFDocument.load(bytes, { ignoreEncryption: false }); }
      catch { throw new Error(`${file.name} could not be opened. It may be damaged or password-protected.`); }
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
      activeLoadingTasks.add(loadingTask);
      let preview;
      try { preview = await loadingTask.promise; }
      finally { activeLoadingTasks.delete(loadingTask); }
      loadedSources.push({ file, bytes, document, preview });
      for (let pageIndex = 0; pageIndex < document.getPageCount(); pageIndex += 1) loadedPages.push({ id: crypto.randomUUID(), sourceIndex, pageIndex, rotation: document.getPage(pageIndex).getRotation().angle || 0 });
    }
    return { sources: loadedSources, pageItems: loadedPages, imageItems: [] };
  } catch (error) {
    await disposeLoaded(loadedSources, []);
    throw error;
  }
}

function loadImages(files) {
  return { sources: [], pageItems: [], imageItems: files.map((file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const isImage = ["png", "jpg", "jpeg"].includes(ext);
    return { id: crypto.randomUUID(), file, url: isImage ? URL.createObjectURL(file) : null };
  }) };
}

async function renderPdfCanvas(item, canvas) {
  if (canvas.renderTask) {
    canvas.renderTask.cancel();
    await canvas.renderTask.promise.catch(() => {});
  }
  const pdfPage = await sources[item.sourceIndex].preview.getPage(item.pageIndex + 1);
  const baseViewport = pdfPage.getViewport({ scale: 1, rotation: item.rotation });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const targetPixelWidth = Math.max(320, Math.min(520, 240 * pixelRatio));
  const scale = Math.max(.5, Math.min(1.35, targetPixelWidth / baseViewport.width));
  const viewport = pdfPage.getViewport({ scale, rotation: item.rotation });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const renderTask = pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport });
  canvas.renderTask = renderTask;
  try { await renderTask.promise; }
  finally { if (canvas.renderTask === renderTask) delete canvas.renderTask; }
}

function updatePageGridMetadata() {
  const items = mode === "images" ? imageItems : pageItems;
  elements.pagesCount.textContent = `${items.length} ${mode === "images" ? (items.length === 1 ? "file" : "files") : (items.length === 1 ? "page" : "pages")}`;
  [...elements.pageGrid.children].forEach((element, index) => {
    element.querySelector(".page-number").textContent = String(index + 1);
    element.setAttribute("aria-label", `${mode === "images" ? "File" : "Page"} ${index + 1} of ${items.length}`);
    const earlier = element.querySelector('[data-action="earlier"]');
    const later = element.querySelector('[data-action="later"]');
    if (earlier) earlier.disabled = index === 0;
    if (later) later.disabled = index === items.length - 1;
  });
}

function syncPageGridOrder() {
  const items = mode === "images" ? imageItems : pageItems;
  const elementsById = new Map([...elements.pageGrid.children].map((element) => [element.dataset.id, element]));
  items.forEach((item) => elements.pageGrid.append(elementsById.get(item.id)));
  updatePageGridMetadata();
}

function moveCurrentItem(fromIndex, toIndex) {
  const items = mode === "images" ? imageItems : pageItems;
  const didMove = Number.isInteger(fromIndex) && Number.isInteger(toIndex) && fromIndex >= 0 && fromIndex < items.length && toIndex >= 0 && toIndex < items.length && fromIndex !== toIndex;
  if (mode === "images") imageItems = moveItem(imageItems, fromIndex, toIndex);
  else pageItems = moveItem(pageItems, fromIndex, toIndex);
  syncPageGridOrder();
  if (didMove) setStatus(`${mode === "images" ? "File" : "Page"} moved to position ${toIndex + 1} of ${items.length}.`, 0);
}

async function renderItems(expectedGeneration = loadGeneration) {
  elements.pageGrid.replaceChildren(); const items = [...(mode === "images" ? imageItems : pageItems)];
  updatePageGridMetadata();
  for (let index = 0; index < items.length; index += 1) {
    if (expectedGeneration !== loadGeneration) return;
    const item = items[index]; const li = document.createElement("li"); li.className = "page-item"; li.dataset.id = item.id; li.draggable = mode === "organize" || mode === "images";
    const preview = document.createElement("div"); preview.className = "page-preview";
    const badge = document.createElement("span"); badge.className = "page-number"; badge.textContent = String(index + 1); preview.append(badge);
    if (mode === "images") {
      const ext = item.file.name.split(".").pop().toLowerCase();
      if (["png", "jpg", "jpeg"].includes(ext)) {
        const image = document.createElement("img"); image.className = "image-preview"; image.src = item.url; image.alt = item.file.name; preview.append(image);
      } else {
        const badge = document.createElement("div"); badge.className = `office-badge office-badge-${ext}`;
        const icon = document.createElement("span"); icon.className = "office-icon"; icon.textContent = ext === "docx" ? "W" : ext === "xlsx" ? "X" : "P";
        const name = document.createElement("span"); name.className = "office-name"; name.textContent = item.file.name;
        badge.append(icon, name); preview.append(badge);
      }
    }
    else {
      const canvas = document.createElement("canvas"); preview.append(canvas);
      try { await renderPdfCanvas(item, canvas); }
      catch { preview.append(document.createTextNode("Preview unavailable")); }
    }
    if (mode === "stamp") { const overlay = document.createElement("div"); overlay.className = "page-stamp-overlay"; overlay.setAttribute("aria-hidden", "true"); preview.append(overlay); }
    if (expectedGeneration !== loadGeneration) return;
    li.append(preview);
    if (mode === "organize" || mode === "images") {
      const actions = document.createElement("div"); actions.className = "page-actions";
      const itemLabel = mode === "images" ? "file" : "page";
      actions.innerHTML = `<button type="button" data-action="earlier" title="Move ${itemLabel} earlier" aria-label="Move ${itemLabel} earlier">←</button><button type="button" data-action="later" title="Move ${itemLabel} later" aria-label="Move ${itemLabel} later">→</button>`;
      if (mode === "organize") {
        actions.classList.add("organize-actions");
        actions.insertAdjacentHTML("beforeend", '<button type="button" data-action="left" title="Rotate page left" aria-label="Rotate page left">↶</button><button type="button" data-action="right" title="Rotate page right" aria-label="Rotate page right">↷</button><button type="button" class="remove-page" data-action="remove" title="Remove page" aria-label="Remove page">×</button>');
      }
      li.append(actions);
    }
    elements.pageGrid.append(li);
  }
  if (expectedGeneration === loadGeneration) { updatePageGridMetadata(); updateStampPreviews(); }
}

function addResult(bytes, filename, detail) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); resultUrls.push(url);
  const card = document.createElement("article"); card.className = "result-card"; const info = document.createElement("div"); const title = document.createElement("strong"); title.textContent = filename; const meta = document.createElement("span"); meta.textContent = `${detail} · ${bytesLabel(bytes.byteLength)}`; info.append(title, meta);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.textContent = "Download"; card.append(info, link); elements.resultsList.append(card);
}

async function processFiles() {
  if (isProcessing) return;
  clearError(); revokeResults();
  if ((mode === "images" ? imageItems : pageItems).length === 0) throw new Error(mode === "images" ? "Choose at least one image or Office document first." : "Choose a PDF first.");
  setProcessingBusy(true); setStatus("Processing locally in your browser…", 28);
  try {
    if (mode === "organize") {
      const bytes = await buildPdfFromPages(sources, pageItems); addResult(bytes, safePdfName(sources[0].file.name, sources.length > 1 ? "merged" : "organized"), `${pageItems.length} pages`);
    } else if (mode === "images") {
      const paperKey = elements.pageSize.value || "image"; const margin = Number(elements.imageMargin.value) || 0; const bytes = await buildMixedPdf(imageItems, paperKey, margin); const firstName = imageItems[0].file.name.replace(/\.[^.]+$/, ""); const mixedName = imageItems.length === 1 ? `${firstName}.pdf` : `${firstName}-merged.pdf`; addResult(bytes, mixedName, `${imageItems.length} files`);
    } else if (mode === "extract") {
      const action = activeValue("extract-action"); const chosen = parsePageSelection(elements.pageSelection.value, pageItems.length);
      if (action === "split") { const outputs = await createSplitPdfs(sources[0].document, chosen); outputs.forEach((bytes, i) => addResult(bytes, safePdfName(sources[0].file.name, `page-${chosen[i] + 1}`), "1 page")); elements.resultsTitle.textContent = `${outputs.length} PDFs are ready`; }
      else { const selectedSet = new Set(chosen); const indices = action === "remove" ? pageItems.map((_, index) => index).filter((index) => !selectedSet.has(index)) : chosen; if (!indices.length) throw new Error("Removing those pages would leave an empty PDF."); const items = indices.map((index) => pageItems[index]); const bytes = await buildPdfFromPages(sources, items); addResult(bytes, safePdfName(sources[0].file.name, action === "remove" ? "pages-removed" : "extracted"), `${items.length} pages`); }
    } else {
      const kind = activeValue("stamp-kind"); const options = { kind };
      if (kind === "numbers") Object.assign(options, { startAt: document.querySelector("#number-start").value, position: document.querySelector("#number-position").value });
      if (kind === "watermark") Object.assign(options, { text: document.querySelector("#watermark-text").value, position: document.querySelector("#watermark-position").value, fontSize: document.querySelector("#watermark-size").value, opacity: document.querySelector("#watermark-opacity").value, color: document.querySelector("#watermark-color").value });
      if (kind === "signature") { if (!signatureFile) throw new Error("Choose a signature image first."); Object.assign(options, { imageBytes: new Uint8Array(await signatureFile.arrayBuffer()), imageType: signatureFile.type || (/\.png$/i.test(signatureFile.name) ? "image/png" : "image/jpeg"), page: document.querySelector("#signature-page").value, position: document.querySelector("#signature-position").value, signatureScale: document.querySelector("#signature-size").value, allPages: document.querySelector("#signature-all").checked }); }
      const bytes = await stampPdf(sources[0].bytes, options); addResult(bytes, safePdfName(sources[0].file.name, kind === "numbers" ? "numbered" : kind === "watermark" ? "watermarked" : "signed"), `${pageItems.length} pages`);
    }
    elements.results.classList.remove("is-hidden"); if (mode !== "extract" || activeValue("extract-action") !== "split") elements.resultsTitle.textContent = "Your PDF is ready"; setStatus("Done. Your file stayed on this device.", 100); elements.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } finally { setProcessingBusy(false); }
}

elements.modeInputs.forEach((input) => input.addEventListener("change", async () => { mode = input.value; await resetWorkspace({ keepMode: true }); }));
elements.input.addEventListener("change", () => loadFiles(elements.input.files));
elements.dropZone.addEventListener("dragover", (event) => { event.preventDefault(); elements.dropZone.classList.add("is-dragging"); });
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
elements.dropZone.addEventListener("drop", (event) => { event.preventDefault(); elements.dropZone.classList.remove("is-dragging"); loadFiles(event.dataTransfer.files); });
elements.clear.addEventListener("click", () => resetWorkspace({ keepMode: true })); elements.reset.addEventListener("click", () => resetWorkspace({ keepMode: false }));
elements.form.addEventListener("submit", (event) => { event.preventDefault(); processFiles().catch((error) => { showError(error); setStatus("Please review the highlighted issue.", 0); setProcessingBusy(false); }); });
elements.pageGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const itemElement = button.closest(".page-item");
  const items = mode === "images" ? imageItems : pageItems;
  const itemIndex = items.findIndex((entry) => entry.id === itemElement.dataset.id);
  if (itemIndex < 0) return;
  if (button.dataset.action === "earlier" || button.dataset.action === "later") {
    moveCurrentItem(itemIndex, itemIndex + (button.dataset.action === "earlier" ? -1 : 1));
    return;
  }
  const item = pageItems[itemIndex];
  if (button.dataset.action === "remove") {
    pageItems = pageItems.filter((entry) => entry !== item); itemElement.remove(); updatePageGridMetadata();
  } else {
    item.rotation = (item.rotation + (button.dataset.action === "right" ? 90 : 270)) % 360;
    const canvas = itemElement.querySelector("canvas");
    try { await renderPdfCanvas(item, canvas); } catch { showError("This page preview could not be refreshed, but the rotation is still saved."); }
  }
  if (!pageItems.length) { elements.pagesSection.classList.add("is-hidden"); showError("All pages were removed. Clear the file or choose another PDF."); }
});
elements.pageGrid.addEventListener("dragstart", (event) => { const item = event.target.closest(".page-item"); if (!item) return; draggedId = item.dataset.id; item.classList.add("is-dragging"); });
elements.pageGrid.addEventListener("dragend", (event) => { event.target.closest(".page-item")?.classList.remove("is-dragging"); draggedId = null; });
elements.pageGrid.addEventListener("dragover", (event) => event.preventDefault());
elements.pageGrid.addEventListener("drop", (event) => { event.preventDefault(); const target = event.target.closest(".page-item"); if (!target || !draggedId || target.dataset.id === draggedId) return; const list = mode === "images" ? imageItems : pageItems; const from = list.findIndex((item) => item.id === draggedId); const to = list.findIndex((item) => item.id === target.dataset.id); if (from < 0 || to < 0) return; moveCurrentItem(from, to); });
document.querySelectorAll('input[name="extract-action"]').forEach((input) => input.addEventListener("change", syncOptionPanels));
document.querySelectorAll('input[name="stamp-kind"]').forEach((input) => input.addEventListener("change", syncOptionPanels));
elements.signatureInput.addEventListener("change", () => { revokeSignaturePreview(); signatureFile = elements.signatureInput.files[0] || null; if (signatureFile) signaturePreviewUrl = URL.createObjectURL(signatureFile); elements.signatureLabel.textContent = signatureFile ? signatureFile.name : "Choose a PNG or JPG signature"; updateStampPreviews(); });
document.querySelector("#watermark-color").addEventListener("input", (event) => { document.querySelector("#watermark-color-value").textContent = event.target.value.toUpperCase(); });
document.querySelectorAll("#number-start, #number-position, #watermark-text, #watermark-position, #watermark-size, #watermark-opacity, #watermark-color, #signature-page, #signature-position, #signature-size, #signature-all").forEach((control) => control.addEventListener("input", updateStampPreviews));

syncOptionPanels();
applyMode();
