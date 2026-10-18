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
// Help prevent accidental source disclosure in the public static artifact.
const html=await readFile(resolve(dist,'index.html'),'utf8');
if(!html.includes('./src/app.js')||!html.includes('id="ai-panel"'))throw Error('public UI entry is incomplete');
await writeFile(resolve(dist,'_headers'),
  '/*\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n\n/api/*\n  Cache-Control: no-store\n','utf8');
console.log('Public-only static assets prepared:',dist);
console.log('Pages Functions live in project-root functions/ and deploy only via Wrangler.');
