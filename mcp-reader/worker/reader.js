const byId = id => document.getElementById(id);
const state = { doc: null, pages: [], file: null, digest: "", page: 1, focus: null, loadToken: 0, renderToken: 0, loading: false, rendering: false, sending: false, pageReady: false, chunks: [], nextChunk: 0, zoomMode: READER_DEFAULTS.fitMode, zoom: 1, savedNotes: [], receipts: [], textAccepted: false };
const bridge = window.ReadingBridge;
function controls() {
  const busy = state.loading || state.rendering || state.sending;
  for (const button of byId("readerToolbar").querySelectorAll(".gmind-reading-selection-tools button")) button.disabled = busy || !state.pageReady;
  const overlay = byId("canvasWrap").querySelector(".gmind-reading-selection-overlay");
  if (overlay) overlay.style.pointerEvents = busy || !state.pageReady ? "none" : "auto";
  byId("jumpPage").disabled = busy || !state.pageReady;
  byId("ocrPage").disabled = busy || !state.pageReady;
  byId("sendText").disabled = busy || !state.pageReady || !bridge.canSend || state.nextChunk >= state.chunks.length;
  byId("saveBookmark").disabled = busy || !state.pageReady;
  byId("restoreBookmark").disabled = busy || !state.pageReady;
  byId("send").disabled = busy || !state.pageReady || !bridge.canSend;
  byId("preview").disabled = busy || !state.pageReady || !bridge.canSend;
  byId("exportPage").disabled = busy || !state.pageReady;
  byId("saveNote").disabled = busy || !state.pageReady;
  for (const id of ["zoomIn", "zoomOut", "zoomRange", "zoomMode"]) byId(id).disabled = busy || !state.pageReady;
  byId("sendVision").disabled = busy || !bridge.canSend || byId("visionCanvas").hidden;
  byId("sample").disabled = busy;
  byId("file").disabled = busy;
  byId("prev").disabled = busy || !state.pageReady || state.page <= 1;
  byId("next").disabled = busy || !state.pageReady || state.page >= (state.doc?.numPages || 0);
  updateProgress();
  byId("slide").style.pointerEvents = busy || !state.pageReady ? "none" : "auto";
}
bridge.onChange(controls);
bridge.diagnostic("pdf-engine", "embedded-parser-ready · no-blob-worker");
function status(message) { byId("status").textContent = message; }
function bytesHex(bytes) { return [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); }
function localStore() { try { return window.localStorage || null; } catch { return null; } }
function persistPosition() {
  if (state.doc) saveReadingPosition(localStore(), state.digest, state.doc.numPages,
    { page: state.page - 1, zoomMode: state.zoomMode, zoom: state.zoom });
}
function syncZoom() {
  byId("zoomRange").value = String(Math.round(state.zoom * 100));
  byId("zoomLabel").textContent = Math.round(state.zoom * 100) + "%";
  byId("zoomMode").value = state.zoomMode;
}
function showNotes() {
  const container = byId("savedNotes"); container.replaceChildren();
  for (const note of state.savedNotes.filter(note => note.page === state.page - 1)) {
    const row = document.createElement("p"); row.textContent = note.text; container.append(row);
  }
}
function chunkPages(pages, maximum = 60000) {
  const chunks = [];
  for (const page of pages) {
    const text = page.text || "[没有可提取文字]";
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(offset + maximum - 160, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const piece = { number: page.number, source: page.textSource || (page.text ? "native-pdf" : "image-only"), start: offset, end, text: text.slice(offset, end) };
      const block = formatPiece(piece);
      const last = chunks.at(-1);
      if (last && last.text.length + block.length + 2 <= maximum) { last.pieces.push(piece); last.text += "\n\n" + block; }
      else chunks.push({ pieces: [piece], text: block });
      offset = end;
    }
  }
  return chunks;
}
function formatPiece(piece) { return "===== 第 " + piece.number + " 页 · 字符 " + (piece.start + 1) + "–" + piece.end + " =====\n文字来源：" + piece.source + "\n" + piece.text; }
function updateProgress() {
  const characters = state.pages.reduce((sum, page) => sum + page.text.length, 0);
  byId("textProgress").textContent = state.doc ? "已提取 " + state.pages.length + " 页 · " + characters.toLocaleString() + " 字符；全文 " + state.chunks.length + " 段，宿主已接受 " + state.nextChunk + " 段请求。" : "打开课件后，可把全部可提取文字分段送入同一对话。";
  byId("sendText").textContent = state.nextChunk >= state.chunks.length && state.doc ? "全文各段请求已接受" : "发送下一段全文" + (state.chunks.length ? "（" + (state.nextChunk + 1) + "/" + state.chunks.length + "）" : "");
}
function textFrom(items) { return items.map(item => item.str || "").join(" ").replace(/\s+/g, " ").trim(); }
async function loadFile(file) {
  if (!file || state.loading || state.rendering || state.sending) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { status("请选 PDF 课件；PPTX 可先从本机共读室导出为 PDF。"); return; }
  selectionController.clear();
  state.loading = true; state.pageReady = false; controls();
  status("正在读取课件文字和页面……");
  const token = ++state.loadToken;
  const previous = state.doc;
  state.doc = null; state.file = null; state.pages = []; state.chunks = []; state.nextChunk = 0; state.savedNotes = []; state.receipts = []; state.textAccepted = false;
  byId("deliveryLog").textContent = "本次打开尚无发送记录；模型实际接收状态未知。";
  byId("notes").value = ""; byId("search").value = ""; byId("searchResults").replaceChildren();
  byId("canvasWrap").hidden = true; byId("empty").hidden = false;
  byId("empty").textContent = "正在读取这份 PDF……";
  try {
    const buffer = await file.arrayBuffer();
    const digest = bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
    await previous?.destroy();
    const doc = await getDocument({ data: new Uint8Array(buffer.slice(0)),
      isEvalSupported: false, useWasm: false, useWorkerFetch: false,
      disableFontFace: true, useSystemFonts: true,
    }).promise;
    const pages = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      let text = "", extractionStatus = "ok";
      try { text = textFrom((await page.getTextContent()).items); }
      catch { extractionStatus = "failed"; }
      pages.push({ number, text, textSource: text ? "native-pdf" : "image-only", extractionStatus, ocrStatus: "not-run" });
      if (number % 20 === 0) {
        status("正在索引 " + number + "/" + doc.numPages + " 页……");
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      page.cleanup?.();
    }
    if (token !== state.loadToken) { await doc.destroy(); return; }
    state.doc = doc; state.file = file; state.digest = digest; state.pages = pages; state.page = 1; state.focus = null;
    const remembered = loadReadingPosition(localStore(), digest, doc.numPages);
    state.zoomMode = READER_DEFAULTS.fitMode; state.zoom = READER_DEFAULTS.zoom;
    state.savedNotes = loadNotes(localStore(), digest, doc.numPages); syncZoom();
    state.chunks = chunkPages(pages); state.nextChunk = 0;
    byId("filename").textContent = file.name;
    state.loading = false;
    await renderPage(remembered ? remembered.page + 1 : 1);
  } catch (error) {
    if (token === state.loadToken) {
      status("课件读取失败：" + error.message);
      byId("empty").textContent = "这份 PDF 没有成功打开，请选择有效且未加密的 PDF。";
      bridge.diagnostic("pdf-load", error.message);
    }
  } finally { state.loading = false; controls(); }
}
async function renderPage(number, {preserveView = false} = {}) {
  if (!state.doc || state.loading || state.rendering || state.sending || number < 1 || number > state.doc.numPages) return;
  const token = ++state.renderToken;
  state.rendering = true; state.pageReady = false; controls();
  const stage = byId("stage"), wrap = byId("canvasWrap");
  const anchor = preserveView ? viewportCenterFraction(stage, wrap.getBoundingClientRect(), stage.getBoundingClientRect()) : null;
  state.page = number;
  if (!preserveView) {
    selectionController.onPageChanged();
    state.focus = null; byId("focus").textContent = "还没有选中具体位置。也可以直接提问当前页。";
    byId("pin").hidden = true;
  } status("正在呈现第 " + number + " 页……");
  try {
    const page = await state.doc.getPage(number);
    const base = page.getViewport({ scale: 1 });
    // Measure the full grid track first; the previous page may have narrowed the paper.
    document.documentElement.classList?.add("pdf-open");
    const paper = byId("paper");
    paper.style.width = "100%";
    stage.style.width = "";
    const padding = READER_DEFAULTS.pagePaddingPx;
    const availableWidth = paper.clientWidth || stage.clientWidth || 1082;
    // A stable pixel cap avoids iframe-height feedback while preserving page ratio.
    const fallbackCap = (globalThis.innerWidth || 1082) < 540 ? READER_DEFAULTS.mobileViewportHeightPx : READER_DEFAULTS.viewportHeightPx;
    const windowHeight = globalThis.visualViewport?.height || globalThis.innerHeight;
    const dock = document.querySelector?.(".send-dock");
    const dockHeight = dock?.getBoundingClientRect().height || 100;
    const stageTop = stage.getBoundingClientRect().top;
    const frameCap = Number.isFinite(windowHeight) && windowHeight > 0
      ? Math.max(80, windowHeight - Math.max(0, stageTop) - dockHeight - 10)
      : fallbackCap;
    stage.style.maxHeight = frameCap + "px";
    const frame = pageFrameSize(base.width, base.height, availableWidth, frameCap, padding);
    paper.style.width = frame.width + 2 + "px"; // paper's two one-pixel borders
    stage.style.width = frame.width + "px";
    stage.style.height = frame.height + "px";
    const scale = getScale(state.zoomMode, state.zoom, base.width, base.height,
      frame.width, frame.height, padding);
    const viewport = page.getViewport({scale});
    const dpr = renderRatio(viewport.width, viewport.height, Math.max(READER_DEFAULTS.minDpr, Math.min(READER_DEFAULTS.maxDpr, globalThis.devicePixelRatio || 1)), READER_DEFAULTS.maxPixels);
    const pixels = page.getViewport({scale: scale * dpr});
    const canvas = byId("slide");
    canvas.width = Math.max(1, Math.round(pixels.width)); canvas.height = Math.max(1, Math.round(pixels.height));
    canvas.style.width = wrap.style.width = viewport.width + "px";
    canvas.style.height = wrap.style.height = viewport.height + "px";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: pixels }).promise;
    if (token !== state.renderToken) return;
    state.pageReady = true;
    byId("renderDiagnostics").textContent = JSON.stringify({readerVersion:"16.3.1",mode:state.zoomMode,zoom:state.zoom,
      devicePixelRatio:globalThis.devicePixelRatio || 1,effectiveDpr:dpr,cssWidth:viewport.width,cssHeight:viewport.height,
      bitmapWidth:canvas.width,bitmapHeight:canvas.height,pageRatio:base.width/base.height,
      frameWidth:stage.clientWidth,frameHeight:stage.clientHeight,settingsSource:"versioned-source-defaults"}, null, 2);
    bridge.diagnostic("pdf-render-ready", "page=" + number + " width=" + canvas.width + " height=" + canvas.height);
    byId("empty").hidden = true; byId("canvasWrap").hidden = false;
    document.documentElement.classList?.add("pdf-open");
    if (anchor) {
      const rect = wrap.getBoundingClientRect(), vr = stage.getBoundingClientRect();
      const scroll = desiredScrollToCenter(anchor, rect.left-vr.left+stage.scrollLeft,
        rect.top-vr.top+stage.scrollTop, rect.width, rect.height, stage.clientWidth, stage.clientHeight);
      stage.scrollLeft = scroll.left; stage.scrollTop = scroll.top;
    } else { stage.scrollLeft = 0; stage.scrollTop = 0; }
    byId("jumpPage").value = String(number);
    byId("jumpPage").max = String(state.pages.length);
    byId("counter").textContent = number + " / " + state.doc.numPages;
    selectionController.alignOverlay();
    showNotes(); persistPosition();
    byId("prev").disabled = number <= 1; byId("next").disabled = number >= state.doc.numPages;
    status("第 " + number + " 页已打开。点击课件可定位。");
  } catch (error) {
    byId("canvasWrap").hidden = true; byId("empty").hidden = false;
    byId("empty").textContent = "这一页没有成功呈现。可重新选择课件。";
    bridge.diagnostic("pdf-render", error.message);
    status("这一页呈现失败：" + error.message);
  } finally {
    state.rendering = false; controls();
  }
  if (state.pageReady && !state.pages[number-1]?.text && state.pages[number-1]?.ocrStatus === "not-run" && ocrRuntimeAvailable())
    await recognizeCurrentPage();
}
function nearestText(items, x, y, viewport) {
  let best = null; let distance = Infinity;
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const pt = Util.transform(viewport.transform, item.transform);
    const dx = Math.max(pt[4] - x, 0, x - (pt[4] + Math.max(6, item.width * viewport.scale)));
    const dy = Math.abs(pt[5] - y);
    const d = Math.hypot(dx, dy);
    if (d < distance) { distance = d; best = item.str.trim(); }
  }
  return distance < 85 ? best : "";
}
const selectionController = installReadingSelection({
  stage: byId("canvasWrap"), canvas: byId("slide"), toolbar: byId("readerToolbar"),
  getPageNumber: () => state.page, getDocumentFingerprint: () => state.digest,
  onError: error => status("选择失败：" + error.message),
  onSelectionChanged: selected => {
    state.focus = selected?.kind === "point" ? {...selected.point, nearbyText:"", clickId:selected.selectionId} : null;
    byId("pin").hidden = true;
    byId("focus").textContent = !selected ? "选择课件上的位置、拖动框选，或选择整页。" :
      selected.kind === "region" ? "已框选；发送时附上整页与选区图像。" :
      selected.kind === "page" ? "已选择整页讲解。" : "已点选；发送时结合整页讲解此处。";
  },
});
byId("file").addEventListener("change", async event => {
  const file = event.target.files?.[0]; event.target.value = "";
  await loadFile(file);
});
byId("prev").addEventListener("click", () => renderPage(state.page - 1));
byId("next").addEventListener("click", () => renderPage(state.page + 1));
byId("sample").addEventListener("click", async () => {
  const bytes = Uint8Array.from(atob("__SAMPLE_PDF__"), character => character.charCodeAt(0));
  await loadFile({ name: "共读示例.pdf", type: "application/pdf", arrayBuffer: async () => bytes.buffer.slice(0) });
});

function markedImage() {
  const source = byId("slide");
  const canvas = makePageImage(source, state.focus);
  return canvas.toDataURL("image/jpeg", .82).split(",")[1];
}
async function sendPage(draft = false, fullText = false) {
  if (!state.doc || !state.file || !state.pageReady || state.loading || state.rendering || state.sending || !bridge.canSend) return;
  const page = state.page, focus = state.focus && { ...state.focus };
  const formatPage = p => "===== 第 " + p.number + " 页 =====\n" +
    "文字来源：" + (p.textSource || (p.text ? "native-pdf" : "image-only")) +
    (p.ocrStatus && p.ocrStatus !== "not-run" ? "；OCR 状态：" + p.ocrStatus : "") + "\n" +
    (p.text || "[没有可提取文字；请依据真实页图讲解，不得猜测 OCR 结果]");
  let delivered = state.textAccepted && !fullText
    ? state.pages.filter(p => Math.abs(p.number - page) <= 1) : state.pages;
  let courseText = fullText ? "" : delivered.map(formatPage).join("\n\n");
  if (!fullText && courseText.length > 150000) {
    delivered = [state.pages[page - 1]];
    courseText = formatPage(delivered[0]);
    if (courseText.length > 150000) { status("当前页文字超过一次消息的可靠长度；请把这一页另存为较短的 PDF。"); return; }
    for (const neighbor of [state.pages[page - 2], state.pages[page]]) {
      if (!neighbor) continue;
      const addition = "\n\n" + formatPage(neighbor);
      if (courseText.length + addition.length <= 150000) { delivered.push(neighbor); courseText += addition; }
    }
  }
  const chunkIndex = state.nextChunk;
  const chunk = fullText ? state.chunks[chunkIndex] : null;
  if (fullText && !chunk) return;
  if (chunk) courseText = chunk.text;
  const completeText = !chunk && delivered.length === state.pages.length;
  const question = byId("question").value.trim();
  const header = ["请在当前对话继续和我共读这份课件。下方是这份 PDF 的文字（来源逐页标识），附有当前页真实图像。",
    "课件：" + state.file.name, "PDF SHA-256：" + state.digest,
    "总页数：" + state.pages.length, "正在看：第 " + page + " 页",
    "本页文字状态：" + (state.pages[page-1].textSource || "native-pdf") +
      (state.pages[page-1].ocrEngine ? "；识别引擎：" + state.pages[page-1].ocrEngine + "；OCR 置信度：" + (state.pages[page-1].ocrConfidence ?? "未知") + "（不是正确率保证，公式与图表以图像为准）" : ""),
    chunk ? "全文分段：第 " + (chunkIndex + 1) + "/" + state.chunks.length + " 段；文字范围第 " + [...new Set(chunk.pieces.map(p => p.number))].join("、") + " 页（字符范围见段内标签）。只确认本段到达，不要声称已读未送达的段。页图为正在看的第 " + page + " 页，未必是本段文字所在页。" : completeText ? "文字范围：全部页面" : "文字范围：仅第 " + delivered.map(p => p.number).sort((a,b) => a-b).join("、") + " 页；其他页尚未送达，请勿据此推断。翻页后可继续发送。",
    focus ? "点击位置（归一化）：" + focus.x.toFixed(4) + ", " + focus.y.toFixed(4) + "；点击 ID：" + focus.clickId + "；附近文字：" + (focus.nearbyText || "无") : "当前页没有点击定位",
    "共读书签（我记录的结论与未解问题）：" + (byId("notes").value.trim() || "尚未记录"),
    "本页保存的重点：" + (state.savedNotes.filter(note => note.page === page - 1).map(note => note.text).join("；") || "尚未保存"),
    "我的问题：" + (chunk ? "这是全文资料的连续分段，请简短确认收到的段号与页码，等我送完再综合讲解。" : question || "请结合当前页讲解，优先照顾我点中的位置。")].join("\n");
  const selected = selectionController.getSelection();
  const receipt = {sendId: crypto.randomUUID(), documentFingerprint: state.digest, page,
    selectionId: selected?.selectionId || null, kind: selected?.kind || "page",
    textPages: chunk ? [...new Set(chunk.pieces.map(p => p.number))] : delivered.map(p => p.number),
    textSource: state.pages[page - 1].textSource || "native-pdf", status: "preparing",
    modelReceived: "unknown", createdAt: new Date().toISOString()};
  state.receipts.push(receipt); if (state.receipts.length > 30) state.receipts.shift();
  updateDeliveryLog();
  state.sending = true; controls(); status("正在把这一页和课件文字交给当前聊天……");
  try {
    if (focus) {
      const pdfPage = await state.doc.getPage(page);
      const viewport = pdfPage.getViewport({scale:parseFloat(byId("slide").style.width)/pdfPage.getViewport({scale:1}).width});
      focus.nearbyText = nearestText((await pdfPage.getTextContent()).items,focus.x*viewport.width,focus.y*viewport.height,viewport);
    }
    const activeSelection = selected || makeSelection({kind:"page",pageNumber:page,documentFingerprint:state.digest,selectionId:crypto.randomUUID()});
    receipt.selectionId = activeSelection.selectionId;
    const scope = {point:"点选：结合整页解释点中位置",region:"框选：重点解释选区，并结合整页",page:"整页：完整讲解当前页"}[activeSelection.kind];
    const extras = [];
    let regionText = "";
    if (activeSelection.kind === "region") {
      const entry = state.pages[page - 1], r = activeSelection.region;
      if (entry.textSource === "ocr-unverified") {
        regionText = (entry.ocrBlocks || []).filter(b => b.box && b.box.x < r.x+r.width && b.box.x+b.box.width > r.x && b.box.y < r.y+r.height && b.box.y+b.box.height > r.y).map(b => b.text).join(" ");
      } else if (entry.textSource === "native-pdf") {
        const pdfPage = await state.doc.getPage(page), viewport = pdfPage.getViewport({scale:1});
        regionText = (await pdfPage.getTextContent()).items.filter(item => {
          if (!item.str || !item.transform) return false;
          const t = Util.transform(viewport.transform, item.transform);
          const x = t[4]/viewport.width, y = t[5]/viewport.height;
          const w = Math.abs(item.width || 0)/viewport.width;
          const h = Math.hypot(t[2],t[3])/viewport.height;
          return x < r.x+r.width && x+w > r.x && y-h < r.y+r.height && y > r.y;
        }).map(item => item.str).join(" ");
      }
    }
    if (activeSelection.kind === "region" && !fullText) {
      const capture = await captureSelectionImage(byId("slide"), activeSelection);
      const data = new Uint8Array(await capture.blob.arrayBuffer()).toBase64();
      extras.push({type:"image",data,mimeType:"image/png",_meta:{"openai/title":"第 " + page + " 页 · 框选区域"}});
    }
    if (state.page !== page || state.digest !== activeSelection.documentFingerprint || selectionController.getSelection() !== selected) throw Error("选择已变化，请重新发送。");
    const image = markedImage();
    await bridge.send([
      { type: "text", text: header + "\n范围：" + scope + "\n选择记录：" + JSON.stringify(activeSelection) +
        (focus ? "\n附近文字：" + (focus.nearbyText || "无") : "") +
        (activeSelection.kind === "region" ? "\n选区关联文字（按位置近似，视觉以选区图为准）：" + (regionText || "无可匹配文字") : "") +
        "\n发送 ID：" + receipt.sendId + "；文字来源：" + receipt.textSource +
        "\n图文关联：整页图像=第 " + page + " 页；选区图像=" + (extras.length ? "同页选区" : "未请求") +
        "；图像是否可见以当前聊天实际收到的附件为准。\n\n" + courseText },
      { type: "image", data: image, mimeType: "image/jpeg", _meta: { "openai/title": "第 " + page + " 页" } },
      ...extras,
    ], { draft });
    receipt.status = draft ? "draft-host-accepted" : "host-accepted";
    receipt.images = bridge.lastReceipt || {path:"standard-mcp",modelReceived:"unknown"};
    updateDeliveryLog();
    if (!draft && completeText) state.textAccepted = true;
    if (chunk && !draft) state.nextChunk = chunkIndex + 1;
    status(draft ? "请求已接受。请在当前聊天检查文字和页图附件，再点聊天的发送。" : "发送请求已被聊天接受；请核对当前对话中的文字、页图和回应。宿主确认不代表图像已被模型读到。");
  } catch (error) { receipt.status = "failed"; receipt.error = error.message; updateDeliveryLog(); status("没有送达：" + error.message); }
  finally { state.sending = false; controls(); }
}
byId("send").addEventListener("click", () => sendPage(false));
byId("preview").addEventListener("click", () => sendPage(true));

byId("sendText").addEventListener("click", () => sendPage(false, true));
byId("search").addEventListener("input", () => {
  const results = byId("searchResults"); results.replaceChildren();
  const query = byId("search").value.trim().toLocaleLowerCase();
  if (!query || !state.doc) return;
  const matches = state.pages.filter(page => page.text.toLocaleLowerCase().includes(query));
  const count = document.createElement("p"); count.className = "muted";
  count.textContent = "整本共 " + matches.length + " 页匹配" + (matches.length > 40 ? "，先显示前 40 页；可缩小关键词。" : "。"); results.append(count);
  for (const page of matches.slice(0, 40)) {
    const index = page.text.toLocaleLowerCase().indexOf(query);
    const button = document.createElement("button"); button.className = "secondary";
    button.textContent = "第 " + page.number + " 页 · " + page.text.slice(Math.max(0, index - 35), index + query.length + 70);
    button.addEventListener("click", () => renderPage(page.number)); results.append(button);
  }
});
function bookmarkData() {
  return { format: "gmind-reading-bookmark", version: 1, sha256: state.digest, pages: state.pages.length,
    page: state.page, focus: state.focus, notes: byId("notes").value.slice(0, 8000), question: byId("question").value.slice(0, 8000) };
}
async function restoreBookmark(text) {
  if (!state.doc || state.loading || state.rendering || state.sending) throw Error("请先打开课件并等待页面就绪。");
  if (text.length > 40000) throw Error("书签过长。");
  const data = JSON.parse(text);
  if (data.format !== "gmind-reading-bookmark" || data.version !== 1 || data.sha256 !== state.digest || data.pages !== state.pages.length) throw Error("书签与当前 PDF 不一致；没有恢复。");
  if (!Number.isInteger(data.page) || data.page < 1 || data.page > state.pages.length || typeof data.notes !== "string" || data.notes.length > 8000 || typeof data.question !== "string" || data.question.length > 8000) throw Error("书签内容无效。");
  const focus = data.focus;
  if (focus && (![focus.x, focus.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || typeof focus.nearbyText !== "string" || focus.nearbyText.length > 8000)) throw Error("书签定位无效。");
  await renderPage(data.page);
  if (!state.pageReady) throw Error("书签页面未能呈现。");
  byId("notes").value = data.notes; byId("question").value = data.question;
  if (focus) {
    selectionController.selectPoint({x:focus.x,y:focus.y});
    state.focus.nearbyText = focus.nearbyText;
    byId("pin").style.left = focus.x * 100 + "%"; byId("pin").style.top = focus.y * 100 + "%"; byId("pin").hidden = true;
    byId("focus").textContent = "第 " + state.page + " 页 · " + (focus.nearbyText || "已恢复的点选位置");
  }
  status("已恢复页码、点选和共读笔记。书签不恢复其他对话的全文送达进度；下一次发送会带上笔记。");
}
byId("saveBookmark").addEventListener("click", () => {
  if (!state.pageReady || state.loading || state.rendering || state.sending) return;
  byId("bookmark").value = JSON.stringify(bookmarkData());
  status("续读书签已生成。展开「复制或恢复书签」，复制保存；关闭页面前记得保存最新笔记。");
});
byId("restoreBookmark").addEventListener("click", async () => {
  try { await restoreBookmark(byId("bookmark").value); } catch (error) { status("书签没有恢复：" + error.message); }
});
async function setZoom(mode, zoom) {
  if (state.loading || state.rendering || state.sending) return;
  state.zoomMode = mode; state.zoom = Math.min(4, Math.max(.5, zoom)); syncZoom();
  if (state.doc) await renderPage(state.page, {preserveView:true});
}
function effectiveZoom() {
  if (state.zoomMode === "custom" || !state.doc) return state.zoom;
  const canvas = byId("slide"), stage = byId("stage");
  const width = parseFloat(canvas.style.width), height = parseFloat(canvas.style.height);
  return 1 / fitScales(width, height, stage.clientWidth || 1082, stage.clientHeight || parseFloat(stage.style.height) || 560, READER_DEFAULTS.pagePaddingPx).fitPage;
}
byId("zoomIn").addEventListener("click", () => setZoom("custom", effectiveZoom() + .1));
byId("zoomOut").addEventListener("click", () => setZoom("custom", effectiveZoom() - .1));
byId("zoomRange").addEventListener("change", event => setZoom("custom", Number(event.target.value) / 100));
byId("zoomMode").addEventListener("change", event => setZoom(event.target.value, 1));
byId("saveNote").addEventListener("click", () => {
  const text = byId("notes").value.trim().slice(0, 480);
  if (!state.doc || !text) { status("先在共读笔记里写下本页重点。"); return; }
  state.savedNotes.push({ id: crypto.randomUUID(), page: state.page - 1,
    x: state.focus?.x ?? null, y: state.focus?.y ?? null, text });
  state.savedNotes = normalizeNotes(state.savedNotes, state.doc.numPages);
  const saved = saveNotes(localStore(), state.digest, state.doc.numPages, state.savedNotes);
  showNotes(); status(saved ? "本页重点已保存在此浏览器。" : "本页重点暂存在当前界面；浏览器未允许持久保存，请生成续读书签备份。");
});
async function downloadCanvas(canvas, name) {
  const blob = await canvasPngBlob(canvas);
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
byId("exportPage").addEventListener("click", async () => {
  if (!state.pageReady) return;
  try { await downloadCanvas(makePageImage(byId("slide"), state.focus), "reading-page-" + state.page + ".png"); }
  catch (error) { status("导出失败：" + error.message); }
});
byId("regenerateVision").addEventListener("click", () => {
  paintChallenge(byId("visionCanvas"), makeChallenge());
  byId("visionCanvas").hidden = false; byId("downloadVision").disabled = false;
  byId("visionStatus").textContent = "挑战已生成。KEY 和答案只存在图片像素中。";
  controls();
});
byId("downloadVision").addEventListener("click", async () => {
  try { await downloadCanvas(byId("visionCanvas"), "reading-vision-receipt.png"); }
  catch (error) { byId("visionStatus").textContent = "导出失败：" + error.message; }
});
byId("sendVision").addEventListener("click", async () => {
  if (byId("visionCanvas").hidden || state.sending || !bridge.canSend) return;
  state.sending = true; controls();
  try {
    const image = byId("visionCanvas").toDataURL("image/png").split(",")[1];
    await bridge.send([{ type: "text", text: BLIND_PROMPT },
      { type: "image", data: image, mimeType: "image/png", _meta: { "openai/title": "视觉链路盲测图" } }]);
    byId("visionStatus").textContent = "发送请求已接受。请核对聊天是否真的收到了图片像素及正确回答。";
  } catch (error) { byId("visionStatus").textContent = "没有送达：" + error.message + "；可导出 PNG 手动上传。"; }
  finally { state.sending = false; controls(); }
});

// Keep ordinary clicks for co-reading; pan only with middle mouse or Alt+drag.
const scrollView = byId("stage");
scrollView.addEventListener("wheel", event => {
  if (!(event.ctrlKey || event.metaKey) || !state.pageReady) return;
  event.preventDefault(); setZoom("custom", effectiveZoom() + (event.deltaY < 0 ? .1 : -.1));
}, {passive:false});
let pan = null, suppressAnnotation = false;
scrollView.addEventListener("pointerdown", event => {
  if (event.button !== 1 && !(event.button === 0 && event.altKey)) { suppressAnnotation = false; return; }
  pan = {id:event.pointerId,x:event.clientX,y:event.clientY,left:scrollView.scrollLeft,top:scrollView.scrollTop};
  suppressAnnotation = true; scrollView.setPointerCapture?.(event.pointerId); event.preventDefault();
});
scrollView.addEventListener("pointermove", event => {
  if (pan?.id !== event.pointerId) return;
  scrollView.scrollLeft = pan.left - (event.clientX-pan.x); scrollView.scrollTop = pan.top - (event.clientY-pan.y);
});
for (const eventName of ["pointerup", "pointercancel"]) scrollView.addEventListener(eventName, () => {pan = null;});
scrollView.addEventListener("click", event => {
  if (suppressAnnotation || event.altKey) { suppressAnnotation = false; event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
let resizeTimer;
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {
  clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
    if (state.pageReady && !state.rendering && !state.loading && !state.sending) renderPage(state.page, {preserveView:true});
  }, 100);
}).observe(scrollView);

// Window height can change without changing the page's own scroll frame.
function scheduleViewportFit() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.pageReady && !state.rendering && !state.loading && !state.sending)
      renderPage(state.page, {preserveView:true});
  }, 100);
}
globalThis.addEventListener?.("resize", scheduleViewportFit);
globalThis.visualViewport?.addEventListener("resize", scheduleViewportFit);

function updateDeliveryLog() {
  byId("deliveryLog").textContent = JSON.stringify(state.receipts.slice(-10), null, 2);
}
byId("jumpPage").addEventListener("change", async event => {
  const number = Number(event.target.value);
  if (Number.isInteger(number) && number >= 1 && number <= (state.doc?.numPages || 0)) await renderPage(number);
  else status("页码无效，请输入 1 到 " + (state.doc?.numPages || 0) + "。");
});
async function recognizeCurrentPage() {
  if (!state.pageReady || state.sending || state.rendering || state.loading) return;
  const page = state.page, token = state.renderToken, entry = state.pages[page - 1];
  if (entry.textSource === "native-pdf" && entry.text) { status("当前页已有原生 PDF 文字，无需 OCR。"); return; }
  if (typeof globalThis.TextDetector !== "function" && !ocrRuntimeAvailable()) {
    entry.ocrStatus = "unavailable";
    status("当前浏览器未提供本地 OCR 引擎；可继续发送真实页图作视觉讲解，未生成识别文字。"); return;
  }
  state.rendering = true; controls(); status("正在尝试本地 OCR；识别结果需要核对……");
  try {
    let result;
    if (typeof globalThis.TextDetector === "function") {
      const native = await new globalThis.TextDetector().detect(byId("slide"));
      const canvas = byId("slide");
      result = {text:native.map(r => r.rawValue || "").join("\n"),engine:"browser-text-detector",blocks:native.filter(r => typeof r.rawValue === "string").map(r => ({text:r.rawValue,box:r.boundingBox ? {x:r.boundingBox.x/canvas.width,y:r.boundingBox.y/canvas.height,width:r.boundingBox.width/canvas.width,height:r.boundingBox.height/canvas.height}:null}))};
    } else {
      await new Promise(resolve => setTimeout(resolve, 0));
      result = await recognizeOcrCanvas(byId("slide"));
    }
    if (state.page !== page || state.renderToken !== token) throw Error("页面已变化，已放弃识别结果。");
    const blocks = result.blocks;
    const text = result.text.slice(0,500000);
    entry.ocrEngine = result.engine; entry.ocrConfidence = result.confidence ?? null;
    entry.text = text; entry.textSource = text ? "ocr-unverified" : "image-only";
    entry.ocrStatus = text ? "recognized-needs-review" : "no-text-found"; entry.ocrBlocks = blocks;
    state.chunks = chunkPages(state.pages); state.nextChunk = 0; state.textAccepted = false;
    status(text ? "本地 OCR 已返回待核对文字；可能误识别公式与中英德文字。发送时仍附真实页图。" : "OCR 未识别出文字；仍可发送真实页图。");
  } catch (error) { entry.ocrStatus = "failed"; status("OCR 失败；页图仍可发送：" + error.message); }
  finally { state.rendering = false; controls(); }
}
byId("ocrPage").addEventListener("click", recognizeCurrentPage);
