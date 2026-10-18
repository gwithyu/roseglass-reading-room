/* Start the host handshake before the PDF engine is parsed or initialized. */
(() => {
  // pdf.js 5 uses these recent built-ins. Keep the embedded engine usable on
  // hosts whose browser predates them; no dynamic code generation is required.
  if (!Promise.withResolvers) Promise.withResolvers = function () {
    let resolve, reject; const promise = new this((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  if (!Promise.try) Promise.try = function (callback, ...args) {
    return new this(resolve => resolve(callback(...args)));
  };
  if (!Uint8Array.prototype.toHex) Object.defineProperty(Uint8Array.prototype, "toHex", {
    value() { return Array.from(this, byte => byte.toString(16).padStart(2, "0")).join(""); }, configurable: true, writable: true,
  });
  if (!Uint8Array.prototype.toBase64) Object.defineProperty(Uint8Array.prototype, "toBase64", {
    value() {
      let binary = "";
      for (let offset = 0; offset < this.length; offset += 32768) binary += String.fromCharCode(...this.subarray(offset, offset + 32768));
      return btoa(binary);
    }, configurable: true, writable: true,
  });
  if (!Uint8Array.fromBase64) Uint8Array.fromBase64 = function (encoded) {
    return this.from(atob(encoded), character => character.charCodeAt(0));
  };
  for (const Collection of [Map, WeakMap]) {
    if (!Collection.prototype.getOrInsertComputed) Object.defineProperty(Collection.prototype, "getOrInsertComputed", {
      value(key, callback) {
        if (this.has(key)) return this.get(key);
        const value = callback(key); this.set(key, value); return value;
      }, configurable: true, writable: true,
    });
    if (!Collection.prototype.getOrInsert) Object.defineProperty(Collection.prototype, "getOrInsert", {
      value(key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); }, configurable: true, writable: true,
    });
  }
  const pending = new Map();
  const lines = ["reader v1.0.0"];
  const reports = [];
  let reporting = false;
  let nextId = 1, initialized = false, closed = false;
  let capabilities = {}, onChange = () => {};
  let uploadedPage = null, lastReceipt = null;
  const element = id => document.getElementById(id);
  function diagnostic(stage, message) {
    lines.push(stage + ": " + String(message).slice(0, 600));
    if (lines.length > 16) lines.splice(1, 1);
    element("diagnostics").textContent = lines.join("\n");
    // Only lifecycle and bootstrap failures are reportable. In particular,
    // pdf-load errors, questions, message payloads and file names stay local.
    const reportStage = ({
      "pdf-engine": "pdf-engine-ready", "script-error": "script-error",
      "unhandled-rejection": "script-error", "sandbox-csp": "sandbox-csp",
      "pdf-render-ready": "pdf-render-ready",
    })[stage] || (stage === "ui/initialize" ? (String(message).startsWith("host-connected") ? "host-ready" : "bridge-error") :
      stage === "ui/message" && String(message).startsWith("host-acknowledged") ? "send-ack" : null);
    if (reportStage) {
      const detail = reportStage === "script-error" ?
        (/is not a function/.test(String(message)) ? "TypeError: missing method" : /is not defined/.test(String(message)) ? "ReferenceError: missing global" : /SyntaxError|Unexpected token/.test(String(message)) ? "SyntaxError" : "script-failed") :
        ["sandbox-csp", "host-ready", "pdf-engine-ready", "send-ack", "pdf-render-ready"].includes(reportStage) ?
        String(message).replace(/(?:data:|https?:\/\/)[^\s]+/g, "[URL omitted]").slice(0, 400) : "initialization-failed";
      reports.push({ stage: reportStage, detail });
      if (reports.length > 8) reports.shift();
      void flushReports();
    }
  }
  async function flushReports() {
    if (!initialized || closed || !capabilities.serverTools || reporting) return;
    reporting = true;
    try {
      while (reports.length && !closed) {
        const report = reports.shift();
        const result = await request("tools/call", { name: "report_reading_room_runtime", arguments: report });
        if (result?.isError) break;
      }
    } catch { /* Reporting failure must not block reading or trigger retries. */ }
    finally { reporting = false; }
  }
  function connection(message) { element("connection").textContent = message; }
  function notify(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }, "*");
  }
  function request(method, params, timeout = 20000) {
    if (closed) return Promise.reject(new Error("聊天连接已关闭。"));
    const id = "reader-" + nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        diagnostic(method, "host-timeout");
        reject(new Error("当前聊天没有回应（" + method + "）；内容尚未确认送达。"));
      }, timeout);
      pending.set(id, { resolve, reject, timer, method });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }
  function applyContext(context) {
    if (!context) return;
    for (const [key, value] of Object.entries(context.styles?.variables || {})) {
      if (key.startsWith("--") && typeof value === "string") document.documentElement.style.setProperty(key, value);
    }
    for (const [edge, value] of Object.entries(context.safeAreaInsets || {})) {
      if (["top", "right", "bottom", "left"].includes(edge) && Number.isFinite(value)) {
        document.documentElement.style.setProperty("--safe-" + edge, value + "px");
      }
    }
  }
  function close() {
    closed = true; initialized = false;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("聊天连接已关闭。")); }
    pending.clear(); onChange();
  }
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.jsonrpc !== "2.0") return;
    const data = event.data;
    if (data.method === "ui/notifications/host-context-changed") { applyContext(data.params); return; }
    if (data.method === "ui/notifications/tool-cancelled") { connection("共读界面调用已取消。"); close(); return; }
    if (data.method === "ui/resource-teardown") {
      window.parent.postMessage({ jsonrpc: "2.0", id: data.id, result: {} }, "*"); close(); return;
    }
    if (data.method === "ping") { window.parent.postMessage({ jsonrpc: "2.0", id: data.id, result: {} }, "*"); return; }
    if (data.method) return;
    const call = pending.get(data.id);
    if (!call || (!Object.hasOwn(data, "result") && !data.error)) return;
    clearTimeout(call.timer); pending.delete(data.id);
    if (data.error) {
      const error = new Error(data.error.message || "聊天容器拒绝了请求。");
      error.code = data.error.code;
      diagnostic(call.method, "error " + error.code + " · " + error.message);
      call.reject(error);
    } else call.resolve(data.result);
  });
  window.addEventListener("error", event => diagnostic("script-error", event.message || "脚本或模块加载失败"));
  window.addEventListener("unhandledrejection", event => diagnostic("unhandled-rejection", event.reason?.message || String(event.reason)));
  document.addEventListener("securitypolicyviolation", event => {
    // Record the directive, never a data URL or document content.
    diagnostic("sandbox-csp", event.violatedDirective || event.effectiveDirective);
    connection("阅读界面被聊天沙箱拦截；展开连接诊断可查看具体指令。");
  });
  const bridge = {
    get canSend() {
      return initialized && !!capabilities.message &&
        !!capabilities.message.text &&
        (!!capabilities.message.image || capabilities.experimental?.["openai/message"] !== undefined);
    },
    get lastReceipt() { return lastReceipt; },
    get initialized() { return initialized; },
    diagnostic,
    onChange(callback) { onChange = callback; callback(); },
    async send(content, { draft = false } = {}) {
      await bridge.ready;
      if (draft && capabilities.experimental?.["openai/message"] === undefined) throw new Error("当前容器不支持聊天草稿预览。");
      if (!bridge.canSend) throw new Error("当前聊天未提供文字与图像一起发送的能力。请在支持 MCP Apps 的聊天中打开。");
      // ChatGPT's optional file extension supplies native image IDs. Attach
      // these before posting the message: a ui/message acknowledgment alone
      // does not prove that inline base64 image content entered model context.
      const images = content.filter(block => block.type === "image");
      lastReceipt = {path:"standard-mcp", status:"preparing", modelReceived:"unknown",
        images:images.map(image => ({title:image._meta?.["openai/title"] || "页图",mimeType:image.mimeType}))};
      if (images.length && typeof window.openai?.uploadFile === "function" && typeof window.openai?.setWidgetState === "function") {
        try {
          const imageIds = [];
          for (const image of images) {
          if (uploadedPage?.data !== image.data || uploadedPage?.mimeType !== image.mimeType) {
            const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
            const file = new File([bytes], image.mimeType === "image/png" ? "reading-vision.png" : "reading-page.jpg", { type: image.mimeType });
            const uploaded = await window.openai.uploadFile(file, { library: false });
            if (typeof uploaded?.fileId !== "string" || !uploaded.fileId.trim()) throw new Error("Missing image ID");
            uploadedPage = { data: image.data, mimeType: image.mimeType, fileId: uploaded.fileId };
          }
          imageIds.push(uploadedPage.fileId);
          lastReceipt.images[imageIds.length - 1].fileId = uploadedPage.fileId;
          }
          await window.openai.setWidgetState({
            modelContent: { currentPageImage: images.map(image => image._meta?.["openai/title"] || "当前页图像").join("；") },
            privateContent: {}, imageIds,
          });
          lastReceipt.path = "native-image-ids";
          diagnostic("native-image-upload", "image ID attached before message");
        } catch {
          diagnostic("native-image-upload", "failed; message not submitted");
          throw new Error("页图上传或关联失败；本次共读尚未发送。");
        }
      } else diagnostic("native-image-upload", "file extension unavailable; standard MCP image path");
      const result = await request("ui/message", {
        role: "user", content,
        ...(capabilities.experimental?.["openai/message"] !== undefined ?
          { _meta: { "openai/message": { target: "active", send: !draft } } } : {}),
      });
      if (result?.isError === true) throw new Error("聊天容器未接受本次内容。");
      diagnostic("ui/message", "host-acknowledged · requested text + image · " + (draft ? "draft" : "send"));
      lastReceipt.status = draft ? "draft-host-accepted" : "host-accepted";
      return result;
    },
  };
  window.ReadingBridge = bridge;
  bridge.ready = (async () => {
    if (window.parent === window) {
      connection("当前页面没有连接聊天；可查看 PDF，发送需要从聊天内打开共读室。");
      diagnostic("ui/initialize", "no-parent-host");
      return false;
    }
    try {
      const result = await request("ui/initialize", {
        appInfo: { name: "roseglass-reading-room", version: "1.0.0" },
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        protocolVersion: "2026-01-26",
      });
      if (!result?.protocolVersion || !result.hostCapabilities) throw new Error("聊天初始化响应不完整。");
      capabilities = result.hostCapabilities;
      applyContext(result.hostContext);
      notify("ui/notifications/initialized");
      initialized = true;
      if (typeof ResizeObserver !== "undefined") {
        let previousHeight = 0, scheduled = false;
        const measure = () => {
          if (scheduled || closed) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            const height = Math.ceil(document.documentElement.scrollHeight);
            if (height > 0 && height !== previousHeight) {
              previousHeight = height;
              notify("ui/notifications/size-changed", { height });
            }
          });
        };
        new ResizeObserver(measure).observe(document.documentElement);
        measure();
      }
      diagnostic("ui/initialize", "host-connected · " + result.protocolVersion);
      connection(bridge.canSend ? "已连接当前聊天 · 可先预览附件，再发送共读" : "已连接聊天，但容器未提供图像消息能力；暂不能发送课件。");
      onChange();
      return true;
    } catch (error) {
      diagnostic("ui/initialize", error.message);
      connection("聊天连接失败：" + error.message);
      onChange(); return false;
    }
  })();
})();
