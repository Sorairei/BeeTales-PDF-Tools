# BeeTales PDF Tools

BeeTales PDF Tools is a free, open-source PDF toolkit that runs entirely in the browser. It helps people organize, split, create, number, watermark, and sign PDF files without uploading their documents to a server.

> **Your files never leave this device.**
>
> No uploads, accounts, cookies, analytics, or remote conversion service.

## Features

| Category | Tool | Description |
| --- | --- | --- |
| Organize | Merge PDFs | Combine multiple PDF files into a single document. |
| Organize | Reorder pages | Arrange pages visually with drag and drop. |
| Organize | Rotate pages | Rotate individual pages left or right. |
| Organize | Remove pages | Delete unwanted pages before creating the result. |
| Split | Extract pages | Create a new PDF from ranges such as `1-3, 5, 8`. |
| Split | Remove selected pages | Keep the original document except for the selected pages. |
| Split | Split pages | Export selected pages as individual PDF files. |
| Create | Images to PDF | Convert ordered JPG and PNG images into one PDF. |
| Create | Page sizing | Fit images to their natural size, A4, or Letter pages. |
| Create | Image margins | Create pages with no margin, a small margin, or a large margin. |
| Mark | Page numbers | Add page numbers in several header and footer positions. |
| Mark | Watermarks | Add diagonal text at the top, center, bottom, or across the full page. |
| Mark | Watermark styling | Choose watermark text, size, opacity, and color. |
| Sign | Image signature | Place a PNG or JPG signature on one page or every page. |
| Preview | Page thumbnails | Review PDF pages locally before processing. |
| Preview | Live stamp preview | See page numbers, watermark styling, placement, patterns, and signatures directly on the thumbnails. |

## How It Works

1. The user selects PDF or image files from their device.
2. The browser reads the selected files through the local File API.
3. PDF.js renders page previews without sending the document anywhere.
4. The user chooses pages, order, rotation, watermark settings, or signature placement and sees lightweight live previews on the page thumbnails.
5. `pdf-lib` creates or modifies the PDF in browser memory.
6. The finished document becomes a temporary local object URL.
7. The browser downloads the result directly to the user's device.
8. Temporary data is released when files are cleared or the browser tab is closed.

No document content is transmitted to BeeTales, GitHub, or a third-party conversion provider.

## Architecture

```mermaid
flowchart LR
    A["Local files"] --> B["Browser File API"]
    B --> C["BeeTales application controller"]
    C --> D["PDF.js preview engine"]
    C --> E["pdf-lib processing engine"]
    D --> F["Local page thumbnails"]
    E --> G["PDF stored in browser memory"]
    G --> H["Temporary object URL"]
    H --> I["Local download"]
```

### Application layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| Interface | `index.html`, `style.css` | Tool selection, responsive layout, accessibility labels, page controls, and result downloads. |
| Application | `app.js` | File handling, page previews, drag and drop, state management, validation, and user feedback. |
| PDF operations | `core.mjs` | Page ranges, copying, rotation, splitting, numbering, watermark placement, and signatures. |
| Rendering | `vendor/pdfjs/` | Local PDF page rendering and thumbnail generation. |
| PDF creation | `vendor/pdf-lib/` | Local PDF creation and modification. |
| Brand assets | `assets/`, `favicon.ico`, `favicon.png` | BeeTales identity, mascot, logo, and browser icons. |
| Verification | `test/` | Automated checks for page selection, rotation, numbering, and watermark behavior. |

### Repository structure

```text
BeeTales-PDF-Tools/
|-- index.html
|-- style.css
|-- app.js
|-- core.mjs
|-- favicon.ico
|-- favicon.png
|-- assets/
|   |-- beetales-logo-v2.png
|   `-- sora-avatar.png
|-- vendor/
|   |-- pdf-lib/
|   `-- pdfjs/
|-- test/
|   `-- core.test.mjs
|-- LICENSE
`-- README.md
```

## Privacy by Design

| Privacy property | Implementation |
| --- | --- |
| No uploads | Files are read and processed only by the browser on the current device. |
| No backend | The application has no document-processing server or database. |
| No accounts | All tools are available without registration or authentication. |
| No tracking | The project includes no analytics, advertising, or tracking scripts. |
| No cookies | The application does not create or require cookies. |
| No runtime CDN | PDF libraries are included in the repository and loaded locally. |
| Temporary results | Downloads use browser object URLs instead of permanent cloud storage. |

## Technology

| Technology | Purpose |
| --- | --- |
| HTML5 | Semantic structure, file inputs, forms, and accessible controls. |
| CSS | BeeTales visual identity and responsive desktop/mobile layouts. |
| JavaScript modules | Local application state and browser-side processing. |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Create, copy, modify, number, watermark, and sign PDF documents. |
| [PDF.js](https://github.com/mozilla/pdf.js) | Render local PDF page previews. |
| Browser File and Blob APIs | Read input files and create temporary local downloads. |

## Supported Browsers

BeeTales PDF Tools is designed for current versions of:

| Browser | Support |
| --- | --- |
| Google Chrome | Supported |
| Microsoft Edge | Supported |
| Mozilla Firefox | Supported |
| Apple Safari | Supported |

JavaScript modules, Web Workers, the File API, and Blob URLs must be enabled.

## Known Limitations

- Password-protected or encrypted PDF files are not supported.
- Very large documents may require substantial memory because all processing happens locally.
- Existing images embedded inside arbitrary PDFs are not recompressed in the current release.
- Signatures are placed as images and do not create cryptographic digital signatures.
- Browser download settings may require confirmation when splitting many pages into separate files.
- Complex or damaged PDF files may not render identically in every browser.

## Project Principles

- **Private:** documents remain on the user's device.
- **Simple:** tools use clear language and visual page controls.
- **Accessible:** core features do not require an account, subscription, or technical experience.
- **Portable:** the application is static and does not depend on a conversion backend.
- **Open source:** the code can be inspected, improved, and shared under the MIT License.

## License

BeeTales PDF Tools is released under the [MIT License](LICENSE).

Copyright (c) 2026 [Sorairei](https://github.com/Sorairei).
