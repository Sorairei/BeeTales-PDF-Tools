# BeeTales PDF Tools

A static, open-source PDF toolkit that works entirely in the browser. Files are opened, processed, and downloaded on the user's device—there is no backend, account, analytics service, or upload step.

## Current features

- Merge multiple PDF files.
- Reorder pages with drag and drop.
- Rotate or remove individual pages.
- Extract selected pages with ranges such as `1-3, 5, 8`.
- Remove selected pages.
- Split selected pages into individual PDF files.
- Convert JPG and PNG images into a PDF.
- Add page numbers in several positions.
- Add a diagonal text watermark with custom color, size, and opacity.
- Place a PNG or JPG signature on one page or every page.
- Render local page previews with PDF.js.
- Responsive, accessible interface based on the BeeTales Media Converter visual language.

## Privacy

- No backend or database.
- No cookies or analytics.
- No file uploads.
- No runtime CDN requests.
- `pdf-lib` and PDF.js are stored in the local `vendor/` directory.
- Generated files use temporary browser object URLs and disappear when the tab closes.

## Local development

Install the development dependencies and copy the browser libraries into `vendor/`:

```bash
npm install
npm run vendor
```

Serve the directory from a local web server:

```bash
npm run serve
```

Opening `index.html` directly with `file://` is not recommended because browsers can block JavaScript modules and the PDF.js worker.

## Tests

```bash
npm test
```

The tests cover page-range parsing, page copying/reordering/rotation, and page-number stamping.

## GitHub Pages

The project is fully static. Commit `index.html`, `style.css`, `app.js`, `core.mjs`, `assets/`, and `vendor/`, then enable GitHub Pages for the repository. The `node_modules/` directory is not required in production.

## Browser support and limits

- Use a current version of Chrome, Edge, Firefox, or Safari.
- Very large PDFs can use substantial memory because processing happens locally.
- Password-protected PDFs are not supported.
- Existing images inside arbitrary PDF files are not recompressed in this release; that requires a separate rendering/re-encoding workflow and can reduce document quality.

## Built with

- [pdf-lib](https://github.com/Hopding/pdf-lib) for creating and modifying PDFs.
- [PDF.js](https://github.com/mozilla/pdf.js) for local page previews.

## License

MIT
