# Roseglass Reading Room

**An independent, privacy-first PDF / PPTX reading room with highly transparent frosted-glass UI, optional ChatGPT follow-up, and local-first files.**

This is a **new, clean-room public starter implementation**, not an export or derivative copy of any private memory system or proprietary project. It contains no private endpoints, secrets, account IDs, conversations, document samples, telemetry, or personal data.

## Features

- **Slides first:** document fills the flexible reading pane; thumbnails are hidden by default; the toolbar stays compact. Desktop/mobile, full screen, **a 50–300% zoom slider** (relative to fit-page size), **Fit page / Fit width / Custom** presets, scrollable enlarged slides, and remembered zoom preferences.
- **Actual high-transparency glass:** translucent rose/charcoal surfaces with `backdrop-filter: blur()` and optional supporting gradients; no opaque pink wall.
- **PDF:** open locally with Mozilla PDF.js, page navigation, text extraction, multi-page search, lazy thumbnails, full-text segmented transfer.
- **PPTX:** open locally with MIT-licensed `pptx-browser` canvas renderer, page navigation, approximate text extraction from OOXML, and segmented transfer. Legacy `.ppt` isn't supported.
- **Study workflow:** click to mark a normalized point; page context export; local bookmarks by truncated SHA-256 fingerprint; drag-and-drop; no private credentials.
- **ChatGPT:** when embedded as a permitted ChatGPT App UI and `window.openai.sendFollowUpMessage` exists, send textual page context to the ongoing conversation. Otherwise copy/export for manual paste. No claim is made that this standalone site automatically attaches page images or reopens an existing private ChatGPT chat.
- **No backend:** all document parsing remains in the browser. On first file open, browser downloads the public libraries from the CDN; on-page PDF/PPTX contents are not uploaded by this app.

## Run

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Or serve this folder with any static file server, including GitHub Pages. Do not use `file://` as module and browser security policies differ across browsers.

## ChatGPT integration

The stand-alone UI detects `window.openai?.sendFollowUpMessage({prompt})` (ChatGPT-specific extension). To make a *real ChatGPT App*, supply your own MCP server and UI resource registration according to the current [OpenAI Apps SDK documentation](https://developers.openai.com/plugins/build/chatgpt-ui). This repository intentionally does **not** carry a connection to any private application or memory infrastructure. If the extension is unavailable, buttons copy or download text only.

**Important limitation:** `sendFollowUpMessage` accepts **text**; it doesn't magically attach the rendered slide as an image. A slide containing only graphics must be exported separately or uploaded by the user to make the visual content available to the model. Long presentations are segmented at ~9k characters each, delivered on repeated button presses. PDF text extraction depends on an embedded text layer; scanned pages require OCR beyond this starter's scope.

## Reading size

The footer reading controls let you pick **适应整页 (Fit page)**, **适应宽度 (Fit width)**, or **自定义比例 (Custom)**. The slider and ± buttons control 50–300% relative to the current fit-page size; enlarged pages overflow into a scrollable viewport rather than being resized back down. Zoom preferences are stored only in this browser under `roseglass:v1:zoom`, with no file contents or private account data. Full-screen hides browser chrome where supported. Glass/blur is applied to surrounding UI, **never to the slide canvas itself**.

## Browser and network requirements

Modern Chromium, Firefox or Safari with Canvas, `DecompressionStream('deflate-raw')` and ES modules. These two public JS libraries are loaded lazily and version-pinned:

- PDF.js `5.4.296`, Mozilla / Apache-2.0 (`cdn.jsdelivr.net`).
- `pptx-browser` `4.1.5`, MIT (`esm.sh`).

For CSP-restricted or offline deployments, vendor *matching version* JS modules and the PDF.js worker into your own deployment and replace the URLs in `src/app.js`. The exact CDN bundling and host CSP compatibility should be tested in the target environment before production distribution.

## Security / privacy notes

- There is no server upload or analytics. Browser bookmark state persists locally under `roseglass:v1:bookmarks:*`, keyed by document SHA-256 digest prefix, **never by a file name or extracted text**.
- Sending to ChatGPT or copying context is explicitly user initiated. The text of the selected page (or consecutive chunks) is sent only after clicking a send control.
- Search results are inserted using `textContent`, not untrusted HTML. Selected files are not sent to the CDN, but scripts fetched from a CDN execute in the page; privacy-sensitive hosts should self-host audited libraries.
- For very large/complex documents browsers may run out of memory. There is a 250 MB input cap and a 6 MB per-slide XML extraction cap.
- This starter is not an official OpenAI product; no name or logo affiliation is implied.

## Publish to GitHub

1. Create a new **public empty repository** (e.g., `roseglass-reading-room`) under your GitHub account; do **not** convert or open-source an existing private repository.
2. Unzip this starter into your new local repository.
3. Run `git add . && git commit -m "Add privacy-first glass reading room" && git push -u origin main`.
4. To host: enable **Settings → Pages → Deploy from a branch → main / (root)**, or use your preferred static hosting.

## License

This starter's original application source is released under MIT (see `LICENSE`). Third-party libraries have their own licenses, and are loaded separately.