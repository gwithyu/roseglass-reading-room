/* Real pdf.js + native canvas, with a simulated MCP host and DOM. No browser or ChatGPT claim. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { SourceTextModule, createContext, runInContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const canvasModule = process.env.READER_CANVAS_MODULE ||
  (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/@oai/artifact-tool/node_modules/skia-canvas" : "skia-canvas");
const { Canvas, DOMMatrix, Path2D, ImageData } = require(canvasModule);
const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const response = await worker.fetch(new Request("https://test/mcp", { method: "POST", body: JSON.stringify({jsonrpc:"2.0",id:1,method:"resources/read",params:{uri:"ui://gmind-reading-chat/reader-v12.html"}}) }));
const html = (await response.json()).result.contents[0].text;
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(m => m[2]);

function fixture() {
  const stream = s => `<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream("BT /F1 14 Tf 40 250 Td (PAGE 1 KEY: CEDAR-731) Tj ET\n0 0 1 rg 150 80 80 80 re f\nq 50 0 0 50 280 80 cm /Im1 Do Q"),
    stream("BT /F1 14 Tf 40 250 Td (PAGE 2 KEY: IRIS-428) Tj ET\n0 0.7 0 rg 150 80 m 230 80 l 190 160 l h f"),
    "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 25 >>\nstream\nff00000000ff00ff00ffff00>\nendstream",
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function environment({ image = true, rejection = false, reporting = false, nativeUpload = false, uploadFailure = false, offlineOcr = false } = {}) {
  const nodes = new Map(), listeners = new Map(), messages = [], timers = new Set();
  const decorate = node => {
    node.style = {setProperty(){}}; node.hidden=false; node.disabled=false; node.value=""; node.textContent="";
    node.dataset = {}; node.attributes = {}; node.setAttribute = (k,v) => {node.attributes[k]=v;};
    node.querySelectorAll = selector => selector.includes('button') ? node.children.flatMap(c=>c.querySelectorAll('button').concat(c.dataset?.action?[c]:[])) : [];
    node.querySelector = () => node.children.find(c=>c.className==='gmind-reading-selection-overlay');
    node.appendChild = child => {node.children.push(child); return child;};
    node.ownerDocument = {createElement:tag=>decorate({})};
    node.children = []; node.replaceChildren = (...children) => { node.children = children; }; node.append = (...children) => node.children.push(...children);
    node.handlers = new Map();
    node.addEventListener = (name, fn) => node.handlers.set(name, fn);
    node.scrollLeft=0; node.scrollTop=0;
    node.clientWidth=1082; Object.defineProperty(node,"clientHeight",{get:()=>parseFloat(node.style.height)||720});
    node.getBoundingClientRect = () => {const width=parseFloat(node.style.width)||node.width||1082,height=parseFloat(node.style.height)||node.height||720; return {left:0,top:0,width,height,right:width,bottom:height};};
    return node;
  };
  const makeCanvas = () => {
    const c = decorate(new Canvas(1,1));
    c.toBlob = (callback,mime) => c.toBuffer(mime).then(buffer=>callback(new Blob([buffer],{type:mime})));
    return c;
  };
  for (const id of ["jumpPage","ocrPage","deliveryLog","paper","readerToolbar","sendText","saveBookmark","restoreBookmark","search","searchResults","notes","bookmark","textProgress","sample","preview","file","send","status","connection","diagnostics","filename","empty","canvasWrap","counter","pin","prev","next","focus","question","stage","renderDiagnostics","zoomIn","zoomOut","zoomRange","zoomLabel","zoomMode","saveNote","savedNotes","exportPage","regenerateVision","downloadVision","sendVision","visionStatus"]) nodes.set(id,decorate({}));
  nodes.set("slide",makeCanvas());
  nodes.set("visionCanvas",makeCanvas()); nodes.get("visionCanvas").hidden=true;
  const dispatch = (name, data) => { for(const fn of listeners.get(name)||[]) fn(data); };
  const parent = { postMessage(message) {
    messages.push(message);
    if (message.method === "ui/initialize") queueMicrotask(()=>dispatch("message", {source:parent,data:{jsonrpc:"2.0",id:message.id,result:{protocolVersion:"2026-01-26",hostCapabilities:{...(reporting?{serverTools:{}}:{}),message:{text:{},...(image?{image:{}}:{})},experimental:{...(image?{"openai/message":{}}:{})}},hostContext:{}}}}));
    if (message.method === "tools/call") queueMicrotask(()=>dispatch("message", {source:parent,data:{jsonrpc:"2.0",id:message.id,result:{content:[],structuredContent:{accepted:true}}}}));
    if (message.method === "ui/message") queueMicrotask(()=>dispatch("message", {source:parent,data:{jsonrpc:"2.0",id:message.id,...(rejection?{error:{code:-32000,message:"fixture host rejected image"}}:{result:{}})}}));
  } };
  const sandbox = {
    console:{log(){},warn(){},error(){}}, crypto:webcrypto, structuredClone,
    DOMMatrix, Path2D, ImageData, ReadableStream, TransformStream, AbortController, AbortSignal,
    atob, btoa, DOMException, EventTarget, Event,
    Uint8Array, Uint8ClampedArray, Int8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder, URL, Blob, File, performance, queueMicrotask,
    requestAnimationFrame(fn){queueMicrotask(()=>fn(performance.now()));return 1;},cancelAnimationFrame(){},
    navigator:{userAgent:"reader-native-canvas-test",platform:"Linux"},
    setTimeout(fn, ms){const timer=setTimeout(fn,ms);timer.unref();timers.add(timer);return timer;},
    clearTimeout(timer){clearTimeout(timer);timers.delete(timer);},
    document:{
      getElementById:id=>nodes.get(id),
      createElement:tag=>tag==="canvas"?makeCanvas():decorate({}),
      documentElement:{style:{setProperty(){}}},
      addEventListener(name,fn){listeners.set(name,[...(listeners.get(name)||[]),fn]);},
    },
    parent,
    addEventListener(name,fn){listeners.set(name,[...(listeners.get(name)||[]),fn]);},
  };
  if (offlineOcr) Object.assign(sandbox,{DecompressionStream,Response,WebAssembly});
  sandbox.window=sandbox; sandbox.self=sandbox;
  if (nativeUpload) sandbox.openai={
    async uploadFile(file,options){
      messages.push({method:"native-upload",file,options});
      if(uploadFailure)throw Error("fixture upload failed");
      return {fileId:"file-fixture-current-page"};
    },
    setWidgetState(state){messages.push({method:"native-state",state});},
    async getFileDownloadUrl({fileId}){return {downloadUrl:"https://files.oaiusercontent.com/"+fileId+"?signed=fixture"};},
  };
  const context=createContext(sandbox);
  runInContext(scripts[0],context);
  for (let index = 1; index < scripts.length; index++) {
    const module = new SourceTextModule(scripts[index] + (index === scripts.length - 1 ? "\nexport {loadFile, state, renderPage, chunkPages, bookmarkData, restoreBookmark, selectionController};" : ""),{context});
    await module.link(()=>{throw Error("Unexpected external module dependency");});
    await module.evaluate();
    if (index === scripts.length - 1) for (const key of ["loadFile", "state", "renderPage", "chunkPages", "bookmarkData", "restoreBookmark", "selectionController"]) context[key] = module.namespace[key];
  }
  await context.ReadingBridge.ready;
  const file = bytes => ({name:"readback.pdf",type:"application/pdf",arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
  return {context,nodes,messages,dispatch,parent,file,async run(code){return await runInContext(code,context);},close(){for(const t of timers)clearTimeout(t);}};
}

test("real PDF renders different pages and sends current text, click and JPEG in one active-thread message",async()=>{
  const env=await environment();
  try {
    assert.equal(env.messages[0].method,"ui/initialize");
    assert.equal(env.messages[1].method,"ui/notifications/initialized");
    env.nodes.get("file").files=[env.file(fixture())];
    await env.nodes.get("file").handlers.get("change")({target:env.nodes.get("file")});
    assert.equal(env.nodes.get("file").value, "", "the same local file can be selected again");
    assert.equal(env.nodes.get("counter").textContent,"1 / 2",env.nodes.get("status").textContent);
    assert.equal(env.nodes.get("canvasWrap").hidden,false);
    assert.equal(env.nodes.get("send").disabled,false);
    const canvas=env.nodes.get("slide");
    if (process.env.READER_QA_OUTPUT) {
      await mkdir(process.env.READER_QA_OUTPUT,{recursive:true});
      await writeFile(process.env.READER_QA_OUTPUT+"/readback.pdf", fixture());
      await canvas.toFile(process.env.READER_QA_OUTPUT+"/page-1.png");
    }
    const pixel1=canvas.getContext("2d").getImageData(190*canvas.width/400,180*canvas.height/300,1,1).data;
    assert.ok(pixel1[2]>200 && pixel1[0]<30,"PDF page 1 blue graphic rendered");
    env.nodes.get("canvasWrap").querySelector().handlers.get("pointerdown")({button:0,clientX:80,clientY:90,preventDefault(){},stopPropagation(){}});
    assert.equal(env.context.selectionController.getSelection().kind,"point");
    await env.nodes.get("send").handlers.get("click")();
    let sent=env.messages.filter(m=>m.method==="ui/message").at(-1);
    assert.equal(sent.params._meta["openai/message"].target,"active");
    assert.deepEqual(Array.from(sent.params.content,c=>c.type),["text","image"]);
    assert.match(sent.params.content[0].text,/CEDAR-731/);
    assert.match(sent.params.content[0].text,/附近文字：PAGE 1/);
    assert.ok(Buffer.from(sent.params.content[1].data,"base64").subarray(0,2).equals(Buffer.from([255,216])));
    assert.match(env.nodes.get("status").textContent,/请求已被聊天接受/);
    const image1=sent.params.content[1].data;
    await env.run("renderPage(2)");
    assert.equal(env.nodes.get("counter").textContent,"2 / 2");
    if (process.env.READER_QA_OUTPUT) await canvas.toFile(process.env.READER_QA_OUTPUT+"/page-2.png");
    assert.equal(env.nodes.get("pin").hidden,true,"focus reset on navigation");
    env.nodes.get("canvasWrap").querySelector().handlers.get("pointerdown")({button:0,clientX:80,clientY:90,preventDefault(){},stopPropagation(){}});
    assert.equal(env.context.selectionController.getSelection().pageNumber,2);
    await env.nodes.get("send").handlers.get("click")();
    sent=env.messages.filter(m=>m.method==="ui/message").at(-1);
    assert.match(sent.params.content[0].text,/正在看：第 2 页/);
    assert.match(sent.params.content[0].text,/附近文字：PAGE 2 KEY: IRIS-428/);
    assert.notEqual(sent.params.content[1].data,image1,"image comes from the new real PDF page");
  } finally {env.close();}
});

test("host rejection stays a failure, and unsupported image messages remain disabled",async()=>{
  const rejected=await environment({rejection:true});
  const unsupported=await environment({image:false});
  try {
    for(const env of [rejected,unsupported]) {
      env.context.selectedPDF=env.file(fixture()); await env.run("loadFile(selectedPDF)");
    }
    await rejected.nodes.get("send").handlers.get("click")();
    assert.match(rejected.nodes.get("status").textContent,/没有送达.*fixture host rejected/);
    assert.equal(unsupported.nodes.get("send").disabled,true);
    await unsupported.nodes.get("send").handlers.get("click")();
    assert.equal(unsupported.messages.filter(m=>m.method==="ui/message").length,0);
  } finally {rejected.close();unsupported.close();}
});

test("invalid PDF and render failures cannot send stale page images",async()=>{
  const env=await environment();
  try {
    env.context.selectedPDF=env.file(fixture()); await env.run("loadFile(selectedPDF)");
    env.context.brokenPDF=env.file(Buffer.from("broken PDF")); await env.run("loadFile(brokenPDF)");
    assert.equal(env.nodes.get("send").disabled,true);
    assert.equal(env.nodes.get("canvasWrap").hidden,true);
    await env.nodes.get("send").handlers.get("click")();
    assert.equal(env.messages.filter(m=>m.method==="ui/message").length,0);
    await env.run("loadFile(selectedPDF)");
    await env.run("state.doc.getPage = async () => { throw new Error('fixture render failure'); }; renderPage(2)");
    assert.equal(env.nodes.get("send").disabled,true);
    assert.match(env.nodes.get("status").textContent,/呈现失败/);
  } finally {env.close();}
});

test("messages from unrelated frames cannot resolve initialization or send requests",async()=>{
  const env=await environment();
  try {
    env.dispatch("message",{source:{},data:{jsonrpc:"2.0",method:"ui/resource-teardown",id:5}});
    assert.equal(env.context.ReadingBridge.initialized,true);
    env.dispatch("securitypolicyviolation",{violatedDirective:"worker-src"});
    assert.match(env.nodes.get("diagnostics").textContent,/sandbox-csp: worker-src/);
  } finally {env.close();}
});

test("runtime diagnostics report initialization and rendering without document content",async()=>{
  const env=await environment({reporting:true});
  try {
    env.context.selectedPDF=env.file(fixture()); await env.run("loadFile(selectedPDF)");
    await env.nodes.get("send").handlers.get("click")();
    const reports=env.messages.filter(m=>m.method==="tools/call");
    assert.ok(reports.some(m=>m.params.arguments.stage==="host-ready"));
    assert.ok(reports.some(m=>m.params.arguments.stage==="pdf-render-ready"));
    assert.doesNotMatch(JSON.stringify(reports),/CEDAR-731|IRIS-428|readback\.pdf|base64/);
    env.context.ReadingBridge.diagnostic("pdf-load","PRIVATE PDF TEXT");
    env.context.ReadingBridge.diagnostic("unhandled-rejection","PRIVATE PDF TEXT");
    assert.doesNotMatch(JSON.stringify(env.messages.filter(m=>m.method==="tools/call")),/PRIVATE PDF TEXT/);
  } finally {env.close();}
});

test("sample is a real two-page PDF and preview drafts the current JPEG without sending",async()=>{
  const env=await environment();
  try {
    await env.nodes.get("sample").handlers.get("click")();
    assert.equal(env.nodes.get("counter").textContent,"1 / 2");
    await env.nodes.get("preview").handlers.get("click")();
    const message=env.messages.filter(m=>m.method==="ui/message").at(-1);
    assert.equal(message.params._meta["openai/message"].target,"active");
    assert.equal(message.params._meta["openai/message"].send,false);
    assert.match(message.params.content[0].text,/CEDAR-731/);
    assert.ok(Buffer.from(message.params.content[1].data,"base64").length>1000);
    assert.match(env.nodes.get("status").textContent,/检查文字和页图附件/);
  } finally {env.close();}
});

test("native page JPEG upload and image ID association complete before the same-chat message",async()=>{
  const env=await environment({nativeUpload:true});
  try {
    await env.nodes.get("sample").handlers.get("click")();
    await env.nodes.get("preview").handlers.get("click")();
    const upload=env.messages.find(m=>m.method==="native-upload");
    assert.equal(upload.options.library,false);
    assert.equal(upload.file.type,"image/jpeg");
    const bytes=new Uint8Array(await upload.file.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0,3)),[255,216,255]);
    assert.deepEqual(Array.from(env.messages.find(m=>m.method==="native-state").state.imageIds),["file-fixture-current-page"]);
    assert.ok(env.messages.findIndex(m=>m.method==="native-state")<env.messages.findIndex(m=>m.method==="ui/message"));
    assert.deepEqual(Array.from(env.messages.find(m=>m.method==="ui/message").params.content,block=>block.type),["text","image"]);
    assert.doesNotMatch(JSON.stringify(env.messages.find(m=>m.method==="ui/message")),/download_url|signed=/,"ordinary Chat uses its native image channel without including signed URLs");
    await env.nodes.get("preview").handlers.get("click")();
    assert.equal(env.messages.filter(m=>m.method==="native-upload").length,1,"unchanged page is not uploaded twice");
  } finally {env.close();}
});

test("native image upload failure cannot silently submit a text-only message",async()=>{
  const env=await environment({nativeUpload:true,uploadFailure:true});
  try {
    await env.nodes.get("sample").handlers.get("click")();
    await env.nodes.get("send").handlers.get("click")();
    assert.equal(env.messages.filter(m=>m.method==="ui/message").length,0);
    assert.match(env.nodes.get("status").textContent,/页图上传或关联失败/);
  } finally {env.close();}
});


test("long documents split all page text losslessly, including giant pages and Unicode boundaries", async () => {
  const env = await environment();
  try {
    const pages = [{number:1,text:"FIRST " + "x".repeat(170000) + "🐰END"}, {number:2,text:"第二页".repeat(40000)}, {number:3,text:"LAST PAGE"}];
    env.context.longPages = pages;
    const chunks = await env.run("chunkPages(longPages)");
    assert.ok(chunks.length > 4);
    for (const chunk of chunks) assert.ok(chunk.text.length <= 60000);
    for (const page of pages) assert.equal(chunks.flatMap(c=>Array.from(c.pieces)).filter(p=>p.number===page.number).map(p=>p.text).join(""),page.text);
    for (const chunk of chunks) for (const piece of chunk.pieces) assert.ok(!/[\uD800-\uDBFF]$/.test(piece.text));
  } finally {env.close();}
});

test("full-text sending advances only on accepted send, includes current image and notes, resets with a new PDF", async () => {
  const env = await environment({nativeUpload:true});
  const rejected = await environment({rejection:true});
  try {
    for (const e of [env,rejected]) {
      await e.nodes.get("sample").handlers.get("click")();
      e.context.largePages = [{number:1,text:"A".repeat(160000)},{number:2,text:"LAST-PAGE-UNIQUE"}];
      await e.run("state.pages = largePages; state.chunks = chunkPages(state.pages); state.nextChunk = 0");
      e.nodes.get("notes").value = "仍卡在 NPV 的机会成本";
      await e.nodes.get("sendText").handlers.get("click")();
    }
    assert.equal(rejected.context.state.nextChunk,0);
    assert.equal(env.context.state.nextChunk,1);
    let message = env.messages.filter(m=>m.method==="ui/message").at(-1);
    assert.match(message.params.content[0].text,/第 1\/3 段/);
    assert.match(message.params.content[0].text,/仍卡在 NPV/);
    assert.equal(message.params.content[1].type,"image");
    await env.nodes.get("sendText").handlers.get("click")();
    await env.nodes.get("sendText").handlers.get("click")();
    assert.equal(env.context.state.nextChunk,3);
    assert.equal(env.nodes.get("sendText").disabled,true);
    message = env.messages.filter(m=>m.method==="ui/message").at(-1);
    assert.match(message.params.content[0].text,/LAST-PAGE-UNIQUE/);
    assert.match(message.params.content[0].text,/第 3\/3 段/);
    await env.nodes.get("sample").handlers.get("click")();
    assert.equal(env.context.state.nextChunk,0);
    assert.equal(env.nodes.get("notes").value,"");
  } finally {env.close();rejected.close();}
});

test("bookmark restores exact PDF page and focus, carries notes forward, rejects mismatched PDF and cannot fake delivery progress",async()=>{
  const env=await environment();
  try {
    await env.nodes.get("sample").handlers.get("click")();
    await env.run("renderPage(2)");
    env.nodes.get("notes").value="下次继续解释绿色三角形";
    await env.run("state.focus={x:.25,y:.75,nearbyText:'重点',clickId:'old'}");
    env.context.saved=await env.run("JSON.stringify(bookmarkData())");
    await env.run("renderPage(1)");
    await env.run("restoreBookmark(saved)");
    assert.equal(env.context.state.page,2);
    assert.equal(env.context.state.focus.x,.25);
    assert.notEqual(env.context.state.focus.clickId,"old");
    assert.equal(env.context.state.nextChunk,0);
    await env.nodes.get("send").handlers.get("click")();
    assert.match(env.messages.filter(m=>m.method==="ui/message").at(-1).params.content[0].text,/下次继续解释绿色三角形/);
    await assert.rejects(env.run("restoreBookmark(JSON.stringify({...JSON.parse(saved),sha256:'wrong'}))"),/不一致/);
    await assert.rejects(env.run("restoreBookmark(JSON.stringify({...JSON.parse(saved),focus:{x:NaN,y:0}}))"),/定位无效/);
  } finally {env.close();}
});

test("whole-document search safely renders matches and jumps to a real page",async()=>{
  const env=await environment();
  try {
    await env.nodes.get("sample").handlers.get("click")();
    env.nodes.get("search").value="IRIS";
    env.nodes.get("search").handlers.get("input")();
    const nodes=env.nodes.get("searchResults").children;
    assert.equal(nodes.length,2);
    assert.match(nodes[1].textContent,/第 2 页.*IRIS-428/);
    await nodes[1].handlers.get("click")();
    assert.equal(env.context.state.page,2);
  } finally {env.close();}
});

test("v7 zoom keeps PDF pixels renderable and blind challenge sends no textual answers", async () => {
  const env = await environment();
  try {
    await env.nodes.get("sample").handlers.get("click")();
    const before = env.nodes.get("slide").width;
    await env.nodes.get("zoomIn").handlers.get("click")();
    assert.ok(env.nodes.get("slide").width > before);
    assert.match(env.nodes.get("zoomLabel").textContent, /^\d+%$/);
    env.nodes.get("regenerateVision").handlers.get("click")();
    assert.equal(env.nodes.get("visionCanvas").hidden, false);
    await env.nodes.get("sendVision").handlers.get("click")();
    const sent = env.messages.filter(m => m.method === "ui/message").at(-1);
    assert.equal(sent.params.content[1].mimeType, "image/png");
    assert.match(sent.params.content[0].text, /KEY.*形状.*四格/);
    assert.doesNotMatch(sent.params.content[0].text, /PAGE KEY:|#C64D69|#178C88/);
    assert.ok(Buffer.from(sent.params.content[1].data, "base64").length > 1000);
  } finally { env.close(); }
});

test("v2 HD zoom preserves aspect, selection and active-chat coordinates at 50–400%", async () => {
  const env = await environment();
  try {
    await env.nodes.get("sample").handlers.get("click")();
    const slide = env.nodes.get("slide"), wrap = env.nodes.get("canvasWrap");
    const frame = env.nodes.get("stage"), paper = env.nodes.get("paper");
    assert.ok(Math.abs((parseFloat(frame.style.width)-12)/(parseFloat(frame.style.height)-12)-4/3)<1e-10);
    assert.ok(Math.abs(parseFloat(paper.style.width)-parseFloat(frame.style.width)-2)<1e-10);
    assert.ok(parseFloat(frame.style.width)-parseFloat(slide.style.width)<=25);
    assert.ok(parseFloat(frame.style.height)-parseFloat(slide.style.height)<=25);
    wrap.querySelector().handlers.get("pointerdown")({button:0,clientX:parseFloat(slide.style.width)*.25,clientY:parseFloat(slide.style.height)*.6,preventDefault(){},stopPropagation(){}});
    const focus = {...env.context.state.focus};
    for (const percent of [50, 100, 200, 400]) {
      env.nodes.get("zoomRange").value=String(percent);
      await env.nodes.get("zoomRange").handlers.get("change")({target:env.nodes.get("zoomRange")});
      assert.equal(env.context.state.zoom,percent/100);
      assert.equal(env.context.state.focus.clickId,focus.clickId,"zoom must preserve selected point");
      assert.equal(wrap.querySelector().children[1].hidden,false);
      const cssWidth=parseFloat(slide.style.width), cssHeight=parseFloat(slide.style.height);
      assert.ok(Math.abs(cssWidth/cssHeight-4/3)<1e-10,"CSS keeps original page aspect");
      assert.equal(wrap.style.width,slide.style.width);
      assert.ok(slide.width*slide.height<=16_020_000,"HD backing store stays bounded");
      if(percent<400)assert.ok(slide.width>=cssWidth*1.99,"HD draws real extra pixels");
      // Scrolled page bounds: coordinates must use CSS bounds, never canvas pixels or viewport offsets.
      slide.getBoundingClientRect=()=>({left:-310,top:-90,width:cssWidth,height:cssHeight});
      wrap.querySelector().handlers.get("pointerdown")({button:0,clientX:-310+cssWidth*.6525,clientY:-90+cssHeight*.3787,preventDefault(){},stopPropagation(){}});
      await env.nodes.get("send").handlers.get("click")();
      const sent=env.messages.filter(m=>m.method==="ui/message").at(-1);
      assert.equal(sent.params._meta["openai/message"].target,"active");
      assert.match(sent.params.content[0].text,/点击位置（归一化）：0.6525, 0.3787/);
      assert.equal(sent.params.content[1].type,"image");
      focus.clickId=env.context.state.focus.clickId;
    }
    await env.run('renderPage(2)');
    assert.equal(env.context.state.focus,null,"turning page clears the previous page selection");
  } finally {env.close();}
});


test("v16 starts at Fit Page and reports real backing pixels separately from CSS bounds",async()=>{
 const env=await environment();
 try{
  await env.nodes.get("sample").handlers.get("click")();
  assert.equal(env.context.state.zoomMode,"fit-page");
  const d=JSON.parse(env.nodes.get("renderDiagnostics").textContent);
  assert.equal(d.readerVersion,"16.3.1");assert.equal(d.effectiveDpr,2.5);
  assert.ok(d.bitmapWidth>d.cssWidth*2.49);assert.ok(d.bitmapHeight>d.cssHeight*2.49);
  assert.ok(d.cssHeight<=d.frameHeight);assert.ok(d.cssWidth<=d.frameWidth);
  assert.ok(parseFloat(env.nodes.get("stage").style.height)<=560);
 }finally{env.close();}
});

test('integrated reverse region sends current PDF context, page and native PNG crop with both image IDs',async()=>{
 const env=await environment({nativeUpload:true});
 try {
  await env.nodes.get('sample').handlers.get('click')();
  const controller=env.context.selectionController, canvas=env.nodes.get('slide');
  controller.setMode('region');
  const overlay=env.nodes.get('canvasWrap').querySelector();
  const width=parseFloat(canvas.style.width),height=parseFloat(canvas.style.height);
  const event=(x,y)=>({button:0,pointerId:1,clientX:width*x,clientY:height*y,preventDefault(){},stopPropagation(){}});
  overlay.handlers.get('pointerdown')(event(.8,.75));
  overlay.handlers.get('pointermove')(event(.2,.25));
  overlay.handlers.get('pointerup')(event(.2,.25));
  const selected=controller.getSelection();
  assert.equal(selected.kind,'region');assert.ok(Math.abs(selected.region.width-.6)<1e-9);
  await env.nodes.get('send').handlers.get('click')();
  const sent=env.messages.filter(m=>m.method==='ui/message').at(-1);
  assert.ok(sent,env.nodes.get('status').textContent);
  assert.deepEqual(Array.from(sent.params.content,c=>c.type),['text','image','image']);
  assert.match(sent.params.content[0].text,/CEDAR-731/);
  assert.match(sent.params.content[0].text,/"kind":"region"/);
  const crop=sent.params.content[2];assert.equal(crop.mimeType,'image/png');
  assert.equal(Buffer.from(crop.data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(env.messages.filter(m=>m.method==='native-upload').length,2);
  assert.equal(env.messages.filter(m=>m.method==='native-state').at(-1).state.imageIds.length,2);
  controller.selectWholePage();assert.equal(controller.getSelection().kind,'page');
  await env.nodes.get('send').handlers.get('click')();
  const whole=env.messages.filter(m=>m.method==='ui/message').at(-1);
  assert.equal(whole.params.content.length,2);assert.match(whole.params.content[0].text,/整页：完整讲解/);
  await env.run('renderPage(2)');assert.equal(controller.getSelection(),null);
 } finally {env.close();}
});


test("fit page reserves viewport height for the fixed send dock", async () => {
  const env = await environment();
  try {
    env.context.innerHeight = 500;
    await env.nodes.get("sample").handlers.get("click")();
    const frame = env.nodes.get("stage"), slide = env.nodes.get("slide");
    assert.ok(parseFloat(frame.style.height) <= 390, "page ends above reserved 100px dock and 10px gap");
    assert.ok(Math.abs(parseFloat(slide.style.width)/parseFloat(slide.style.height)-4/3)<1e-10);
  } finally { env.close(); }
});

function multipageFixture(count, {scan=false}={}) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 25 >>\nstream\nff00000000ff00ff00ffff00>\nendstream"];
  const kids=[];
  for(let page=1;page<=count;page++) {
    const pageId=objects.length+1, streamId=pageId+1; kids.push(pageId+" 0 R");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${streamId} 0 R >>`);
    const content=scan ? "q 250 0 0 180 30 30 cm /Im1 Do Q" : `BT /F1 14 Tf 20 250 Td (NATIVE PAGE ${page} UNIQUE-${page}) Tj ET\n0 0 1 rg 50 50 90 60 re f`;
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>`;
  let pdf="%PDF-1.4\n";const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const start=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test("52-page baseline sends full native text then continues with page neighborhood and linked receipts",async()=>{
  const env=await environment({nativeUpload:true});
  try {
    await env.context.loadFile(env.file(multipageFixture(52)));
    assert.equal(env.context.state.pages.length,52);
    await env.nodes.get('send').handlers.get('click')();
    let message=env.messages.filter(m=>m.method==='ui/message').at(-1);
    assert.match(message.params.content[0].text,/NATIVE PAGE 52/);
    assert.equal(message.params.content.filter(c=>c.type==='image').length,1);
    await env.context.renderPage(30);
    env.context.selectionController.selectWholePage();
    await env.nodes.get('send').handlers.get('click')();
    message=env.messages.filter(m=>m.method==='ui/message').at(-1);
    assert.match(message.params.content[0].text,/NATIVE PAGE 29/);
    assert.match(message.params.content[0].text,/NATIVE PAGE 31/);
    assert.doesNotMatch(message.params.content[0].text,/NATIVE PAGE 52/);
    const receipt=env.context.state.receipts.at(-1);
    assert.equal(receipt.page,30);assert.equal(receipt.kind,'page');
    assert.equal(receipt.status,'host-accepted');assert.equal(receipt.modelReceived,'unknown');
    assert.equal(receipt.images.images[0].fileId,'file-fixture-current-page');
    assert.notEqual(receipt.sendId,env.context.state.receipts[0].sendId);
  } finally {env.close();}
});

test("300-page real PDF indexes, searches, jumps and sends only requested page image",async()=>{
  const env=await environment();
  try {
    await env.context.loadFile(env.file(multipageFixture(300)));
    assert.equal(env.context.state.pages.length,300);
    env.nodes.get('search').value='UNIQUE-299';
    env.nodes.get('search').handlers.get('input')();
    assert.match(env.nodes.get('searchResults').children[1].textContent,/第 299 页/);
    await env.nodes.get('jumpPage').handlers.get('change')({target:{value:'299'}});
    assert.equal(env.context.state.page,299);
    await env.nodes.get('send').handlers.get('click')();
    const message=env.messages.filter(m=>m.method==='ui/message').at(-1);
    assert.equal(message.params.content.filter(c=>c.type==='image').length,1);
    assert.match(message.params.content[0].text,/正在看：第 299 页/);
    assert.match(message.params.content[0].text,/NATIVE PAGE 300/);
  } finally {env.close();}
});

test("image-only PDF has explicit missing-OCR status and still delivers real page pixels",async()=>{
  const env=await environment();
  try {
    await env.context.loadFile(env.file(multipageFixture(1,{scan:true})));
    assert.equal(env.context.state.pages[0].textSource,'image-only');
    await env.nodes.get('ocrPage').handlers.get('click')();
    assert.equal(env.context.state.pages[0].ocrStatus,'unavailable');
    await env.nodes.get('send').handlers.get('click')();
    const message=env.messages.filter(m=>m.method==='ui/message').at(-1);
    assert.match(message.params.content[0].text,/image-only/);
    assert.match(message.params.content[0].text,/OCR 状态：unavailable/);
    assert.ok(Buffer.from(message.params.content[1].data,'base64').length>500);
  } finally {env.close();}
});

test("conditional local OCR keeps unverified source and region geometry separate from native text",async()=>{
  const env=await environment();
  try {
    await env.context.loadFile(env.file(multipageFixture(1,{scan:true})));
    env.context.TextDetector=class {async detect(){return [{rawValue:'测试 EN x=2',boundingBox:{x:10,y:20,width:40,height:30}}];}};
    await env.nodes.get('ocrPage').handlers.get('click')();
    const page=env.context.state.pages[0];
    assert.equal(page.textSource,'ocr-unverified');assert.equal(page.ocrStatus,'recognized-needs-review');
    assert.equal(page.text,'测试 EN x=2');assert.ok(page.ocrBlocks[0].box.x>0);
    await env.nodes.get('send').handlers.get('click')();
    const message=env.messages.filter(m=>m.method==='ui/message').at(-1);
    assert.match(message.params.content[0].text,/ocr-unverified/);
    assert.equal(message.params.content.filter(c=>c.type==='image').length,1);
  } finally {env.close();}
});

test("host rejection records failure without claiming the model received text or images",async()=>{
  const env=await environment({rejection:true});
  try {
    await env.context.loadFile(env.file(fixture()));
    await env.nodes.get('send').handlers.get('click')();
    assert.equal(env.context.state.receipts.at(-1).status,'failed');
    assert.equal(env.context.state.receipts.at(-1).modelReceived,'unknown');
    assert.equal(env.context.state.textAccepted,false);
  } finally {env.close();}
});


function scannedTextFixture(jpeg) {
  const content='q 400 0 0 157.142857 0 0 cm /Im1 Do Q';
  const objects=[
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 157.142857] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1400 /Height 550 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]),
    Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];
  let pdf=Buffer.from('%PDF-1.4\n');const offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(pdf.length);pdf=Buffer.concat([pdf,Buffer.from(`${i+1} 0 obj\n`),objects[i],Buffer.from('\nendobj\n')]);
  }
  const xref=pdf.length;
  return Buffer.concat([pdf,Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]);
}
test("real raster-only mixed-language PDF automatically OCRs rendered pixels and sends labeled text plus image",async()=>{
  const env=await environment({offlineOcr:true});
  try {
    const jpeg=await readFile(new URL('./fixtures/ocr-mixed.jpg',import.meta.url));
    await env.context.loadFile(env.file(scannedTextFixture(jpeg)));
    assert.equal(env.context.state.pageReady,true);
    const page=env.context.state.pages[0];
    assert.equal(page.textSource,'ocr-unverified');
    assert.equal(page.ocrEngine,'tesseract-7-lstm');
    assert.match(page.text.replace(/\s/g,''),/市场价格决定价值/);
    assert.match(page.text,/MARKET PRICE 120 EUR/);
    await env.nodes.get('send').handlers.get('click')();
    const message=env.messages.filter(m=>m.method==='ui/message').at(-1);
    assert.match(message.params.content[0].text,/ocr-unverified/);
    assert.match(message.params.content[0].text,/MARKET PRICE 120 EUR/);
    assert.ok(message.params.content.some(c=>c.type==='image'&&c.data.length>1000));
    assert.equal(env.context.state.receipts.at(-1).status,'host-accepted');
  } finally {env.close();}
});
