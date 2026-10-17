# Roseglass Reading Room

**An independent, privacy-first PDF / PPTX reading room with highly transparent frosted-glass UI, optional ChatGPT follow-up, and local-first files.**

This is a **new, clean-room public starter implementation**, not an export or derivative copy of any private memory system or proprietary project. It contains no private endpoints, secrets, account IDs, conversations, document samples, telemetry, or personal data.

## Features

- **Slides first:** document fills the flexible reading pane; thumbnails are hidden by default; the toolbar stays compact. Desktop/mobile, full screen, **a 50–300% zoom slider** (relative to fit-page size), **Fit page / Fit width / Custom** presets, scrollable enlarged slides, and per-document remembered zoom and last page.
- **Actual high-transparency glass:** translucent rose/charcoal surfaces with `backdrop-filter: blur()` and optional supporting gradients; no opaque pink wall.
- **PDF:** open locally with Mozilla PDF.js, page navigation, text extraction, multi-page search, lazy thumbnails, ordered, length-bounded, lossless full-text segmented transfer (including extra-long pages).
- **PPTX:** open locally with MIT-licensed `pptx-browser` canvas renderer, page navigation, approximate text extraction from OOXML, and segmented transfer. Legacy `.ppt` isn't supported.
- **Study workflow:** resume each document at its own last page and zoom (even after reopening the browser); reset only that document’s reading position from Bookmarks; click to mark a normalized point and **save a per-slide annotation** in Bookmarks & Notes; jump back to the saved position, add a short question or note, or delete it; page context export; local bookmarks by truncated SHA-256 fingerprint; drag-and-drop; no private credentials.
- **ChatGPT:** in a supported in-chat App, attempt a page-image-plus-text handoff using the available host APIs; the model must still verify it can actually see the image. In standalone mode (including Free users without plugin extensions), **copy page text and optionally download a marked PNG** to manually send to the reader's own ChatGPT. No automatic login, API key, payment, or shared AI conversation is required.
- **No backend:** all document parsing remains in the browser. On first file open, browser downloads the public libraries from the CDN; on-page PDF/PPTX contents are not uploaded by this app.

## Run

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Or serve this folder with any static file server, including GitHub Pages. Do not use `file://` as module and browser security policies differ across browsers.

## Use with your own ChatGPT (including Free)

The **standalone website** has no paid account prerequisite. Open a PDF or PPTX locally, click a page to mark an important spot, then choose **复制本页给我的 GPT**. Roseglass copies the current page's extracted text, page number, click coordinates, and relevant local notes. Click **打开我的 ChatGPT** and paste the text into **your own ChatGPT account**. For charts, diagrams, scanned slides, or an otherwise visual question, separately click **导出带标记 PNG** to download the actual rendered page **with the clicked position marked**, then attach that image in ChatGPT. This avoids spending Free file-upload quota on text-only slides. There is no invisible file transfer between a normal browser page and the ChatGPT tab. Your PDF/PPTX remains in the browser unless you explicitly send text/images yourself.

For long lectures, **全文分段** copies one ordered text segment at a time. Paste each part into the same ChatGPT conversation before requesting the next; copied does not mean delivered. On mobile browsers that block copying, the reader downloads a text file as a fallback.

ChatGPT Free supports files and images subject to its own usage and upload limits (which OpenAI can change). If the daily upload limit is reached, text-based slides can still be discussed using the copied text; slides with diagrams require that the image actually reach ChatGPT. The standalone website does not make unlimited ChatGPT access available.

**Account separation:** this public project has no g-mind endpoint, shared API token, ChatGPT credential, private session, or persistent server store. Each reader uses their own account. Local reading positions and notes remain on each user's device/browser; they are not synchronized between friends.

## ChatGPT integration

The standalone UI detects optional ChatGPT host APIs for in-chat use. To make a *real ChatGPT App*, supply your own MCP server and UI resource registration according to the current [OpenAI Apps SDK documentation](https://developers.openai.com/plugins/build/chatgpt-ui). This repository intentionally does **not** connect to any private application or memory infrastructure. If the extension is unavailable, the interface falls back to user-controlled **copy text + optional marked PNG download + open own ChatGPT**. This fallback works without the ChatGPT plugin extension.

**Important limitation:** text-only follow-up messages do not themselves attach rendered page images. The in-chat path may attempt a file upload + widget-state reference only when the host exposes all required APIs, and still requires visual readback verification. Otherwise the page PNG is downloaded for manual upload. Long lectures are segmented at ~9k characters and copied/sent one at a time. PDF text extraction depends on an embedded text layer; scanned pages require visual upload and interpretation, not assumed OCR.

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

## Study notes and huge lectures

Open **BOOKMARKS & NOTES** in the top toolbar (closed by default, so the slide remains largest). Optionally click the slide to mark a point, type a note in the sidebar and click **保存本页重点**. Tap a saved note to jump back and show the same pin. Notes are separated by the document SHA-256 fingerprint, persist in this browser, and survive **重置本课件的阅读位置**. They can be deleted independently. Local storage may not persist in incognito or restricted embedded browsers.

**全文分段** now preserves page order across arbitrarily long text pages and splits large pages into consecutive pieces, with a 9,000-character maximum *payload* per piece. The chat prefix adds a small amount beyond that limit. Repeated clicking delivers the next piece; a failed send does not advance. This feature is an export aid, not long-term remote storage.