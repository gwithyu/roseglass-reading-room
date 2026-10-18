# Roseglass MCP Reader 1.0.0

Browser-local PDF co-reading UI and a self-contained MCP Worker. **Original Roseglass code is restricted to unmodified private personal non-commercial use, with no derivatives or redistribution (see ../LICENSE).** This subdirectory provides an MCP implementation for permitted personal use; the original standalone PDF/PPTX app at the repository root remains separate.

## Features

- Point, drag-region and whole-page selection, original PDF aspect ratio, Fit Page / Fit Width / 50–400% zoom.
- Full-page JPEG plus high-resolution region PNG, native PDF text and normalized document/page/selection metadata sent to the current host conversation.
- Native image-ID association when the host provides the optional upload API; explicit upload failure and bounded delivery log. Host acceptance never proves that a model saw pixels.
- Whole-document search, lossless text chunks, previous/current/next page context after the initial full-text request, bookmarks and local notes.
- Offline OCR for Chinese, English and German using bundled Tesseract LSTM WASM and the Chinese/German model pair. Pinned tests cover mixed text and ä, ö, ü, ß. OCR output is unverified; formulas and diagrams must be checked against real page images.

PDF contents stay in the browser until the user explicitly requests a message or attachment. OCR makes no external request. There is no private memory service, API credential, owner identity, or connection to the author's private installation in this export.

## Build and test

Requires Node.js 22+, npm, Python 3 and Bash. Tests also use `skia-canvas` (native binaries may require platform support).

```bash
cd mcp-reader
npm install
npm run build
npm test
npm run validate
```

Output: `dist/server/index.js`, a Worker module exposing `/mcp`. For an unmodified private installation only, set your own `YOUR_PROJECT_ID` in `.openai/hosting.json` or configure your private host endpoint. These installation-only settings do not authorize modifications to the application code or functionality. Do not reuse another installation's project ID, plugin identity or credentials.

Register `/mcp` and its declared MCP UI resource using your host's supported app workflow. Merely opening the website does not attach it to ChatGPT. Host capabilities and account access vary; this code does not guarantee availability on free ChatGPT accounts and does not pay for an AI API.

The optional deployed-source diagnostics are disabled unless a deployment sets `READER_OWNER_EMAIL` and a trusted gateway provides authenticated identity headers. Direct untrusted requests must never be allowed to forge those headers. No owner email is distributed here.

## Verification and limits

72 automated tests pass in the development runtime, including real PDF rasterization, generated 52/300-page PDFs, real raster-only PDF OCR, Chinese/English/German image recognition, search, bookmarks, selection and simulated host delivery. These tests do not certify an actual ChatGPT browser session or complex formula recognition. No user lecture documents or conversation logs are included.

The current self-contained Worker script is about 7.2 MiB. Actual host resource-size limits, UI startup latency, WebAssembly CSP permission, browser responsiveness and image visibility require testing on your target host. OCR runs on the UI thread and can temporarily pause interaction. No remote durable document store or long-term memory writer is provided. Native PPTX belongs to the separate standalone app; this MCP implementation expects PDF.

## Licenses

Original Roseglass application code follows the repository's [personal non-commercial, no-derivatives license](../LICENSE); modification, redistribution, public/multi-user hosting, and commercial use require separate written permission. Validly obtained older MIT-licensed copies keep their historical MIT permissions. Bundled PDF.js and Tesseract core retain their Apache-2.0 notices under `worker/vendor/LICENSE` and `worker/ocr/LICENSE`. Model provenance and asset SHA-256 hashes are in `worker/ocr/PROVENANCE.json`; data packages declare MIT and upstream Tesseract language models use Apache-2.0. Keep those notices when redistributing. Test images are generated synthetic text examples.
