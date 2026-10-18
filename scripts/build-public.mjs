/** Create an upload-ready public-only static folder, WITHOUT any private code, npm or GitHub Actions. */
import {cp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist-public');
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
const required=[
  'index.html',
  'src',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'mcp-reader/worker/vendor/pdf.min.mjs',
  'mcp-reader/worker/vendor/pdf.worker.min.mjs'
];
for(const entry of required){
  const input=resolve(root,entry),output=resolve(dist,entry);
  await mkdir(dirname(output),{recursive:true});
  await cp(input,output,{recursive:true,force:true});
}
// Do not load a third-party PPTX JS module in the same page that accepts API Keys.
// Until a locally audited PPTX bundle is available, the hosted BYOK build accepts PDF.
const appFile=resolve(dist,'src/app.js');
let app=await readFile(appFile,'utf8');
const remote="const {PptxRenderer} = await import('https://esm.sh/pptx-browser@4.1.5?bundle');";
if(!app.includes(remote))throw Error('PPTX dependency changed; re-audit before publishing');
app=app.replace(remote,"throw new Error('公共 API 版暂时只支持 PDF。请将 PPTX 导出为 PDF，以保护个人 API Key。');");
if(app.includes('https://esm.sh/')||app.includes('https://cdn.jsdelivr.net/'))throw Error('Unaudited external executable dependency detected');
await writeFile(appFile,app,'utf8');

// Help prevent accidental source disclosure in the public static artifact.
let html=await readFile(resolve(dist,'index.html'),'utf8');
if(!html.includes('./src/app.js')||!html.includes('id="ai-panel"')||!html.includes('id="invite-panel"'))throw Error('public UI entry is incomplete');
// The hosted public reader uses personal API, not ChatGPT-only embedded host features.
const hostButton='id="send-chat" class="bottom-button primary"';
const visionHostButton='id="send-vision" class="soft-button vision-primary"';
if(!html.includes(hostButton)||!html.includes(visionHostButton))throw Error('ChatGPT host buttons changed: re-audit hosted build');
html=html.replace(hostButton,'id="send-chat" class="bottom-button primary hidden"');
html=html.replace(visionHostButton,'id="send-vision" class="soft-button vision-primary hidden"');
const multiFormat='accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"';
if(!html.includes(multiFormat))throw Error('File input changed: review PPTX boundary');
html=html.replace(multiFormat,'accept=".pdf,application/pdf"').replaceAll('打开 PDF 或 PPTX','打开 PDF');

await writeFile(resolve(dist,'index.html'),html,'utf8');
await writeFile(resolve(dist,'_headers'),
  '/*\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'\n\n/api/*\n  Cache-Control: no-store\n','utf8');
console.log('Public-only static assets prepared:',dist);
console.log('Pages Functions live in project-root functions/ and deploy only via Wrangler.');
