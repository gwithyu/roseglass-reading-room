__MANAGEMENT_JS__
const READER_SOURCES = __READER_SOURCES__;
// Source of the published Worker. scripts/build.sh embeds the UI and pdf.js here.
const UI_URI = "ui://roseglass-reading-room/reader-v16.html";
const OLD_UI_URIS = ["ui://roseglass-reading-room/reader-v15.html", "ui://roseglass-reading-room/reader-v14.html", "ui://roseglass-reading-room/reader-v13.html", "ui://roseglass-reading-room/reader-v12.html", "ui://roseglass-reading-room/reader-v11.html", "ui://roseglass-reading-room/reader-v1.html", "ui://roseglass-reading-room/reader-v3.html", "ui://roseglass-reading-room/reader-v4.html", "ui://roseglass-reading-room/reader-v5.html", "ui://roseglass-reading-room/reader-v6.html", "ui://roseglass-reading-room/reader-v7.html", "ui://roseglass-reading-room/reader-v8.html", "ui://roseglass-reading-room/reader-v9.html", "ui://roseglass-reading-room/reader-v10.html"];
const VERSION = "1.0.0";
const MIME = "text/html;profile=mcp-app";
const UI_HTML = __EMBEDDED_UI_HTML__;
const resourceMeta = {
  ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetDescription": "本地 PDF 共读器：呈现真实页面，点击定位，把当前页文字和页图发到同一聊天。",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
  "openai/ui": { availableDisplayModes: ["inline", "fullscreen"], preferredDisplayMode: "inline" },
};

const appTool = {
  name: "open_reading_room",
  title: "打开共读室",
  description: "在当前聊天打开共读室，选择本机 PDF 课件、点选页面位置，并把真实文字和当前页图像发到本对话。调用时无需参数。",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  _meta: {
    ui: { resourceUri: UI_URI },
    "openai/outputTemplate": UI_URI,
    "openai/toolInvocation/invoking": "正在加载共读界面",
    "openai/toolInvocation/invoked": "共读界面资源已提供",
    "openai/ui": { entrypoints: [{ type: "thread" }, { type: "global" }] },
  },
};
const runtimeStages = ["host-ready", "pdf-engine-ready", "script-error", "bridge-error", "sandbox-csp", "pdf-render-ready", "send-ack"];
const runtimeTool = {
  name: "report_reading_room_runtime",
  description: "Report the reader's technical lifecycle only. Never include PDF text, filenames, images, questions, or credentials.",
  inputSchema: { type: "object", additionalProperties: false, required: ["stage"], properties: {
    stage: { type: "string", enum: runtimeStages }, detail: { type: "string", maxLength: 400 },
  } },
  annotations: { readOnlyHint: true, openWorldHint: false },
  _meta: { ui: { visibility: ["app"] } },
};
const pageImageTool = {
  name: "read_reading_page_image",
  title: "读取共读当前页图像",
  description: "读取用户刚刚从共读器提交的当前页真实图像并返回图像内容。共读消息附带 page_image_file 时，讲解图、颜色或版式前先调用本工具；不要把提取文字当作已经看过图像。不要向用户显示临时下载地址。只读取这次提供的 ChatGPT 图像文件，不保存内容。",
  inputSchema: { type: "object", additionalProperties: false, required: ["image"], properties: {
    image: { type: "object", additionalProperties: false, required: ["download_url", "file_id"], properties: {
      download_url: { type: "string" }, file_id: { type: "string" },
      mime_type: { type: "string" }, file_name: { type: "string" },
    } },
  } },
  outputSchema: { type: "object", additionalProperties: false, required: ["file_id", "mime_type"], properties: {
    file_id: { type: "string" }, mime_type: { type: "string" },
  } },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { "openai/fileParams": ["image"] },
};

async function readPageImage(file) {
  if (!file || typeof file.file_id !== "string" || !file.file_id.trim() || file.file_id.length > 256) throw Error("invalid-file");
  const url = new URL(file.download_url);
  // Accept only the native ChatGPT file host. Never fetch arbitrary web URLs,
  // localhost, custom ports, embedded credentials, or redirect destinations.
  if (url.protocol !== "https:" || url.hostname !== "files.oaiusercontent.com" || url.port || url.username || url.password || url.hash) throw Error("invalid-file-host");
  const response = await fetch(url.href, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { accept: "image/jpeg,image/png,application/octet-stream" } });
  if (!response.ok || !response.body) throw Error("file-unavailable");
  const maximum = 6 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > maximum) throw Error("file-too-large");
  const contentType = response.headers.get("content-type")?.split(";")[0].trim();
  if (!["image/jpeg", "image/png", "application/octet-stream"].includes(contentType)) throw Error("not-image");
  const chunks = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw Error("file-too-large"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const mimeType = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" :
    [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value) ? "image/png" : null;
  if (!mimeType) throw Error("not-image");
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return { content: [{ type: "image", data: btoa(binary), mimeType }], structuredContent: { file_id: file.file_id, mime_type: mimeType } };
}

function rpc(id, result, error) {
  // MCP 2026-07-28 requires resultType on every successful result. Older
  // protocol implementations accept this additional result property too.
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result: { resultType: "complete", ...result } }) }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>共读室</title><style>body{font:16px system-ui,sans-serif;background:linear-gradient(135deg,#ede7e8,#f5f0eb);color:#382f32;max-width:650px;margin:12vh auto;padding:24px;line-height:1.7}a{display:inline-block;background:#795b63;color:white;padding:10px 18px;border-radius:10px;text-decoration:none}</style><h1>在普通 Chat 里共读</h1><p>打开 ChatGPT，选择「聊天」（Chat），在输入框用 @ 选择「共读室 · 在聊天里读」，再说「打开共读室」。阅读器会显示在这段普通聊天中。</p><p>选择 PDF 后，点一下想聊的位置，再点「发给我共读」；也可以先在聊天里预览附件。</p><a href="https://chatgpt.com/">打开 ChatGPT 聊天</a></html>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname !== "/mcp" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    let body;
    try { body = await request.json(); }
    catch { return rpc(null, undefined, { code: -32700, message: "Invalid JSON" }); }
    const { id, method } = body ?? {};
    const params = body?.params ?? {};
    if (!body || body.jsonrpc !== "2.0" || typeof method !== "string") {
      return rpc(id ?? null, undefined, { code: -32600, message: "Invalid request" });
    }
    if (id === undefined && method.startsWith("notifications/")) return new Response(null, { status: 202 });
    // Only protocol stage/version are logged, never PDF data or tool arguments.
    console.info(JSON.stringify({ event: "reading-mcp", method, version: VERSION }));
    if (method === "server/discover") {
      return rpc(id, {
        resultType: "complete", supportedVersions: ["2026-07-28"],
        cacheScope: "private", ttlMs: 0,
        capabilities: { tools: {}, resources: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "roseglass-reading-room", version: VERSION } },
      });
    }
    if (method === "initialize") return rpc(id, {
      protocolVersion: "2025-11-25", capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "roseglass-reading-room", version: VERSION },
    });
    if (method === "ping") return rpc(id, {});
    if (method === "tools/list") return rpc(id, { cacheScope: "private", ttlMs: 0, tools: [appTool, pageImageTool, runtimeTool, ...managementTools] });
    if (method === "tools/call") {
      if (managementTools.some(tool => tool.name === params.name)) {
        try {
          requireReaderOwner(request, env);
          const result = managementResult(params.name, params.arguments ?? {}, {version:VERSION, uri:UI_URI, defaults:READER_DEFAULTS, sources:READER_SOURCES});
          return rpc(id, {content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result});
        } catch(error) {
          return rpc(id, {isError:true,content:[{type:"text",text:error.message === "owner-required" ? "Owner authentication required. No operation was performed." : "Invalid management request. No operation was performed."}]});
        }
      }
      if (params.name === pageImageTool.name) {
        try { return rpc(id, await readPageImage(params.arguments?.image)); }
        catch {
          // Do not log the signed URL, file ID, body, or original fetch error.
          return rpc(id, { isError: true, content: [{ type: "text", text: "当前页图像未能读取。请从共读器重新提交这一页；不要仅凭文字声称已经看过图像。" }] });
        }
      }
      if (params.name === runtimeTool.name) {
        const args = params.arguments;
        if (!args || !runtimeStages.includes(args.stage) || Object.keys(args).some(key => !["stage", "detail"].includes(key)) ||
          (args.detail !== undefined && (typeof args.detail !== "string" || args.detail.length > 400))) {
          return rpc(id, { isError: true, content: [{ type: "text", text: "Invalid technical diagnostic" }] });
        }
        console.info(JSON.stringify({ event: "reader-runtime", version: VERSION, stage: args.stage, detail: args.detail || "" }));
        return rpc(id, { content: [], structuredContent: { accepted: true, version: VERSION } });
      }
      if (params.name !== appTool.name) return rpc(id, { isError: true, content: [{ type: "text", text: "Unknown tool" }] });
      return rpc(id, {
        content: [{ type: "text", text: "共读界面资源已提供；是否打开以聊天中实际出现的 PDF 阅读器为准。" }],
        structuredContent: { version: VERSION, status: "awaiting-ui-initialization", resourceUri: UI_URI },
      });
    }
    if (method === "resources/list") return rpc(id, { cacheScope: "private", ttlMs: 0, resources: [{ uri: UI_URI, name: "共读室界面", mimeType: MIME, _meta: resourceMeta }] });
    if (method === "resources/read") {
      if (![UI_URI, ...OLD_UI_URIS].includes(params.uri)) {
        console.error(JSON.stringify({ event: "reader-resource-error", version: VERSION, code: -32602, parameterKeys: Object.keys(params).slice(0, 6) }));
        return rpc(id, undefined, { code: -32602, message: "Unknown resource" });
      }
      console.info(JSON.stringify({ event: "reader-resource", version: VERSION, uri: params.uri, mimeType: MIME, htmlBytes: new TextEncoder().encode(UI_HTML).byteLength }));
      return rpc(id, { cacheScope: "private", ttlMs: 0, contents: [{
        uri: params.uri, mimeType: MIME, text: UI_HTML, _meta: resourceMeta,
      }] });
    }
    return rpc(id, undefined, { code: -32601, message: "Method not found" });
  },
};
