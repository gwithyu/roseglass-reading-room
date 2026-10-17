# Roseglass Reading Room

**An independent, privacy-first PDF / PPTX reading room with highly transparent frosted-glass UI, optional ChatGPT follow-up, and local-first files.**

This is a **new, clean-room public starter implementation**, not an export or derivative copy of any private memory system or proprietary project. It contains no private endpoints, secrets, account IDs, conversations, document samples, telemetry, or personal data.

## Features

- **Slides first:** document fills the flexible reading pane; thumbnails are hidden by default; the toolbar stays compact. Desktop/mobile, full screen, **a 50–300% zoom slider** (relative to fit-page size), **Fit page / Fit width / Custom** presets, scrollable enlarged slides, and per-document remembered zoom and last page.
- **Actual high-transparency glass:** translucent rose/charcoal surfaces with `backdrop-filter: blur()` and optional supporting gradients; no opaque pink wall.
- **PDF:** open locally with Mozilla PDF.js, page navigation, text extraction, multi-page search, lazy thumbnails, ordered, length-bounded, lossless full-text segmented transfer (including extra-long pages).
- **PPTX:** open locally with MIT-licensed `pptx-browser` canvas renderer, page navigation, approximate text extraction from OOXML, and segmented transfer. Legacy `.ppt` isn't supported.
- **Study workflow:** resume each document at its own last page and zoom (even after reopening the browser); reset only that document’s reading position from Bookmarks; click to mark a normalized point and **save a per-slide annotation** in Bookmarks & Notes; jump back to the saved position, add a short question or note, or delete it; page context export; local bookmarks by truncated SHA-256 fingerprint; drag-and-drop; no private credentials.
- **Visual co-reading (experimental ChatGPT bridge):** click **图文共读** to create a high-resolution PNG from the actual page (independent of visible zoom), overlay the selected point, and—if `window.openai.uploadFile`, `setWidgetState`, and `sendFollowUpMessage` all exist—try to share an image reference plus actual page text in the ongoing conversation. **Receipt of an image ID is not proof that the model saw its pixels.** The message instructs ChatGPT to verify image visibility. Unsupported hosts automatically download the marked PNG and copy/export the page context for you to upload manually. **导出本页 PNG** always works when browser canvas export is permitted. Only your explicit click transfers material. No private backend is used.
- **No backend:** all document parsing remains in the browser. On first file open, browser downloads the public libraries from the CDN; on-page PDF/PPTX contents are not uploaded by this app.

## Run

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Or serve this folder with any static file server, including GitHub Pages. Do not use `file://` as module and browser security policies differ across browsers.

## Experimental live co-reading relay (separate, optional)

An opt-in, independently deployable, **short-lived** relay and read-only MCP tool prototype is under `relay/`. When deployed by someone the reader trusts, the reader can pair **their own GPT conversation once** and then click slide positions without repeatedly copying each page. The current selection includes page text, coordinates and an optional real PNG image. The user still needs to ask their GPT to explain the latest point; clicking does not silently send a ChatGPT message.

**This relay is NOT deployed, not included in the offline-only default, and not verified on Free accounts.** Free/Go web plugin-extension UI remains a separate availability gate; ordinary plugin tool availability is account-dependent. No private g-mind connection, credentials, or memory system is included. See [relay/README.md](relay/README.md) before setting up, especially the explicit consent, data retention and abuse-control requirements.

## ChatGPT integration

The stand-alone UI detects `window.openai?.sendFollowUpMessage({prompt})` (ChatGPT-specific extension). To make a *real ChatGPT App*, supply your own MCP server and UI resource registration according to the current [OpenAI Apps SDK documentation](https://developers.openai.com/plugins/build/chatgpt-ui). This repository intentionally does **not** carry a connection to any private application or memory infrastructure. If the extension is unavailable, buttons copy or download text only.

**Important limitation:** `sendFollowUpMessage` accepts **text**. The optional widget `imageIds` + upload helper may or may not make actual image pixels available to the model in every host/version; this remains **unverified for real ChatGPT end-to-end delivery**. If the assistant cannot describe image-only details, use **导出本页 PNG** and attach the resulting PNG to the current Chat yourself. A private app cannot automatically be recreated by this independent public repo. Long presentations are segmented at ~9k characters each, delivered on repeated button presses. PDF text extraction depends on an embedded text layer; scanned pages require OCR beyond this starter's scope.

## Reading size

The footer reading controls let you pick **适应整页 (Fit page)**, **适应宽度 (Fit width)**, or **自定义比例 (Custom)**. The slider and ± buttons control 50–300% relative to the current fit-page size; enlarged pages overflow into a scrollable viewport rather than being resized back down. Each file has an independent page and zoom record under `roseglass:v2:position:<SHA-256 prefix>` in this browser. The demo still uses the older global `roseglass:v1:zoom` preference, which is never applied to newly opened documents. The reader stores neither file names nor file contents. If browser storage or secure hashing is unavailable, the page works but cannot reliably resume its position. Full-screen hides browser chrome where supported. Glass/blur is applied to surrounding UI, **never to the slide canvas itself**.

## Browser and network requirements

Modern Chromium, Firefox or Safari with Canvas, `DecompressionStream('deflate-raw')` and ES modules. These two public JS libraries are loaded lazily and version-pinned:

- PDF.js `5.4.296`, Mozilla / Apache-2.0 (`cdn.jsdelivr.net`).
- `pptx-browser` `4.1.5`, MIT (`esm.sh`).

For CSP-restricted or offline deployments, vendor *matching version* JS modules and the PDF.js worker into your own deployment and replace the URLs in `src/app.js`. The exact CDN bundling and host CSP compatibility should be tested in the target environment before production distribution.

## Security / privacy notes

- There is no server upload or analytics. Per-file reading position saves `{page, zoomMode, zoom}` and can be reset without touching bookmarks. Browser bookmark state persists locally under `roseglass:v1:bookmarks:*`, keyed by document SHA-256 digest prefix, **never by a file name or extracted text**.
- Annotation records save the page, optional normalized x/y click location and up to 480 characters of user-written notes in local browser storage, never the document itself. Sending the current page also includes its saved notes; nothing is automatically transmitted.
- Sending to ChatGPT or copying context is explicitly user initiated. On **图文共读** the user authorizes uploading just the current rendered PNG and its extracted text when the host supports it; otherwise a local PNG/text is exported. No automatic background upload, telemetry, or storage of a full deck. Hosted ChatGPT may retain uploaded files according to its own privacy policy. Third-party rendering libraries are still loaded from CDNs.
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

## Study notes and huge lectures

Open **BOOKMARKS & NOTES** in the top toolbar (closed by default, so the slide remains largest). Optionally click the slide to mark a point, type a note in the sidebar and click **保存本页重点**. Tap a saved note to jump back and show the same pin. Notes are separated by the document SHA-256 fingerprint, persist in this browser, and survive **重置本课件的阅读位置**. They can be deleted independently. Local storage may not persist in incognito or restricted embedded browsers.

**全文分段** now preserves page order across arbitrarily long text pages and splits large pages into consecutive pieces, with a 9,000-character maximum *payload* per piece. The chat prefix adds a small amount beyond that limit. Repeated clicking delivers the next piece; a failed send does not advance. This feature is an export aid, not long-term remote storage.

## v5: actual page pixels and click point

The PNG exporter draws from the original PDF page or PPTX slide at bounded high resolution (long edge up to 2400 px and about 4.5 megapixels), not from the surrounding blurred glass or mobile-sized preview. A burgundy focus ring marks the normalized click location; notes and extracted text accompany the message. If the image is not readable by the model, it must say so rather than invent a shape or color. The **download PNG** fallback is the dependable way to attach a real image to a normal chat. Automated end-to-end visual receipt in ChatGPT is **not yet confirmed**. For canvas-tainted PPTX assets, the export may fail with an explicit warning and the user can take a screenshot instead.


## v6: actual image-receipt blind test and stale-page guard

Click **◈** in the toolbar to open an image-only challenge overlay. The viewer generates a randomized **PAGE KEY**, colored center shape, and 2×2 color grid as canvas pixels. The follow-up message deliberately contains **none of the answer values**. Click **发往当前 Chat 验收** to test the optional host image-ref pipeline; only a chat response accurately describing the image counts as a successful visual receipt. A successful upload or message request **does not** count. If the host extension is unavailable or fails, the reader exports a PNG for manual attachment to the same chat. The overlay stays off by default and does not shrink the reading canvas.

The v6 image relay also guards against sending a stale page after document switches: it checks document identity both before the upload, after it, and before follow-up. Upload, widget-state, and follow-up errors fail to manual-export instead of silently claiming success. This test does not send lecture data until the user explicitly chooses **图文共读** on a lecture page, which remains a separate button. Visual delivery is **not certified** until tested inside the actual ChatGPT host.

Run `node --test tests/*.test.mjs && node tests/smoke.mjs` to validate local logic and source wiring. Browser rendering, CDN compatibility, and actual ChatGPT image perception require additional integration testing.