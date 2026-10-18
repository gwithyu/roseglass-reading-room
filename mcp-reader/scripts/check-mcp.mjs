import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const call = async (method, params = {}) => {
  const response = await worker.fetch(new Request("https://example.test/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 7);
  assert.equal(body.error, undefined);
  assert.equal(body.result.resultType, "complete", method + " requires MCP 2026-07-28 resultType");
  if (["server/discover", "tools/list", "resources/list", "resources/read"].includes(method)) {
    assert.equal(body.result.cacheScope, "private", method + " requires cacheScope");
    assert.equal(body.result.ttlMs, 0, method + " requires a nonnegative ttlMs");
  }
  return body.result;
};
const discovery = await call("server/discover");
assert.deepEqual(discovery.supportedVersions, ["2026-07-28"]);
const tool = (await call("tools/list")).tools[0];
assert.equal(tool.name, "open_reading_room");
assert.equal(tool._meta["openai/ui"].entrypoints[0].type, "thread");
const uri = tool._meta.ui.resourceUri;
assert.equal(tool._meta["openai/outputTemplate"], uri);
const listed = (await call("resources/list")).resources.find(r => r.uri === uri);
assert.ok(listed, "tool URI is listed as a readable resource");
const resource = (await call("resources/read", { uri })).contents[0];
assert.equal(resource.uri, uri);
assert.equal(resource.mimeType, "text/html;profile=mcp-app");
assert.match(resource.text, /request\("ui\/initialize"/);
assert.match(resource.text, /notify\("ui\/notifications\/initialized"/);
assert.match(resource.text, /request\("ui\/message"/);
assert.match(resource.text, /type: "image"/);
assert.ok(resource.text.length > 100_000, "PDF parser was not embedded");
assert.doesNotMatch(resource.text, /reading-engine:\/\//, "host restricts resource reads outside the widget scope");
const directory = await mkdtemp(join(tmpdir(), "study-room-ui-"));
try {
  const scripts = [...resource.text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 3, "bridge, embedded worker module, reader module");
  for (let i = 0; i < scripts.length; i++) {
    const filename = join(directory, "ui-" + i + ".mjs");
    await writeFile(filename, scripts[i][2]);
    const check = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const opened = await call("tools/call", { name: tool.name, arguments: {} });
assert.equal(opened.isError, undefined);
assert.equal(opened.structuredContent.status, "awaiting-ui-initialization");
assert.equal(opened._meta, undefined, "tool result must not override a cached tool's UI URI");
assert.equal((await call("resources/read", {uri:"ui://roseglass-reading-room/reader-v1.html"})).contents[0].mimeType, resource.mimeType);
assert.equal((await call("initialize")).serverInfo.version, "1.0.0");
assert.equal((await call("resources/read", {uri:"ui://roseglass-reading-room/reader-v3.html"})).contents[0].mimeType, resource.mimeType);
const runtime = (await call("tools/list")).tools.find(t => t.name === "report_reading_room_runtime");
assert.deepEqual(runtime._meta.ui.visibility, ["app"]);
assert.equal((await call("tools/call", {name:runtime.name,arguments:{stage:"host-ready",detail:"fixture"}})).structuredContent.accepted,true);
assert.equal((await call("tools/call", {name:runtime.name,arguments:{stage:"host-ready",pdf:"not permitted"}})).isError,true);
assert.equal((await call("resources/read", {uri:"ui://roseglass-reading-room/reader-v4.html"})).contents[0].text, resource.text);
console.log("MCP 2026-07-28 result/cache contracts, UI linkage and embedded scripts are valid");

const pageImageTool=(await call("tools/list")).tools.find(t=>t.name==="read_reading_page_image");
assert.deepEqual(pageImageTool._meta["openai/fileParams"],["image"]);
assert.deepEqual(pageImageTool.inputSchema.properties.image.required,["download_url","file_id"]);
assert.deepEqual(Object.keys(pageImageTool.inputSchema.properties.image.properties).sort(),["download_url","file_id","file_name","mime_type"]);
const realFetch=globalThis.fetch;
const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=","base64"));
let fetches=0;
try {
  globalThis.fetch=async(url,options)=>{
    fetches++; assert.equal(new URL(url).hostname,"files.oaiusercontent.com"); assert.equal(options.redirect,"error");
    return new Response(png,{headers:{"content-type":"image/png"}});
  };
  const nativeFile={file_id:"file-fixture",download_url:"https://files.oaiusercontent.com/file-fixture?signed=fixture",mime_type:"image/png",file_name:"reading-page.png"};
  const imageResult=await call("tools/call",{name:pageImageTool.name,arguments:{image:nativeFile}});
  assert.equal(imageResult.content[0].type,"image");
  assert.equal(imageResult.content[0].mimeType,"image/png");
  assert.deepEqual(Buffer.from(imageResult.content[0].data,"base64"),Buffer.from(png));
  const baseline=fetches;
  for(const download_url of ["http://files.oaiusercontent.com/x","https://127.0.0.1/x","https://files.oaiusercontent.com.evil.invalid/x","https://u:p@files.oaiusercontent.com/x","https://files.oaiusercontent.com:8443/x"]){
    assert.equal((await call("tools/call",{name:pageImageTool.name,arguments:{image:{...nativeFile,download_url}}})).isError,true);
  }
  assert.equal(fetches,baseline,"untrusted file hosts are rejected before any network request");
  for(const response of [new Response("not an image",{headers:{"content-type":"text/html"}}),new Response(png,{headers:{"content-type":"image/png","content-length":String(6*1024*1024+1)}}),new Response(null,{status:302,headers:{location:"https://example.invalid"}})]){
    globalThis.fetch=async()=>response;
    assert.equal((await call("tools/call",{name:pageImageTool.name,arguments:{image:nativeFile}})).isError,true);
  }
} finally {globalThis.fetch=realFetch;}
console.log("Native page-image tool returns actual image bytes and rejects unrelated hosts, redirects, HTML and oversized files");
