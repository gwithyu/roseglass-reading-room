import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

test('hosted BYOK bundle contains no remote PPTX module or private server code',async()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const built=spawnSync(process.execPath,['scripts/build-public.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr||built.stdout);
  const dist=resolve(root,'dist-public');
  const app=await readFile(resolve(dist,'src/app.js'),'utf8');
  const html=await readFile(resolve(dist,'index.html'),'utf8');
  const headers=await readFile(resolve(dist,'_headers'),'utf8');
  assert.match(headers,/Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self';/);
  assert.doesNotMatch(app,/https:\/\/esm\.sh\//);
  assert.doesNotMatch(app,/https:\/\/cdn\.jsdelivr\.net\//);
  assert.match(app,/暂时只支持 PDF/);
  assert.match(app,/getDocument\(\{data:new Uint8Array\(buffer\.slice\(0\)\),isEvalSupported:false\}\)/,'PDF.js dynamic evaluation must be disabled on BYOK hosted build');
  assert.match(html,/id="ai-api-key" type="password"/);
  assert.match(html,/id="invite-panel"/);
  assert.match(html,/accept=".pdf,application\/pdf"/);
  assert.doesNotMatch(html,/accept=".pdf,.pptx/);
  assert.match(html,/id="send-chat" class="bottom-button primary hidden"/);
  assert.match(html,/id="send-vision" class="soft-button vision-primary hidden"/);
  assert.match(html,/id="toggle-vision-test" class="tool-button hidden"/);
  assert.match(app,/id="send-full" class="bottom-button secondary hidden"/);
  assert.match(app,/独立 PDF 共读 · 连接自己的 AI API · 无需 ChatGPT Plus/);
  assert.match(app,/document\.dispatchEvent\(new Event\('roseglass:document-changed'\)\)/,'successful PDF changes must invalidate stale AI sessions');
  assert.match(app,/getActiveDocumentKey:\(\)=>state\.fileKey/,'AI must compare response with active PDF identity');
  for(const path of ['LICENSE','THIRD_PARTY_NOTICES.md','mcp-reader/worker/vendor/pdf.min.mjs','mcp-reader/worker/vendor/pdf.worker.min.mjs']){
    assert.ok((await stat(resolve(dist,path))).isFile(),path);
  }
  await assert.rejects(stat(resolve(dist,'local-api/server.mjs')));
  await assert.rejects(stat(resolve(dist,'.github/workflows/release.yml')));
  // Fail before publishing if a browser module imports a file absent from the output.
  // A JavaScript parse check alone cannot detect these deployment-time 404 failures.
  const seen=[];
  const files=async dir=>{
    for(const ent of await readdir(dir,{withFileTypes:true})){
      const file=resolve(dir,ent.name);
      if(ent.isDirectory())await files(file);
      else if(/\.(?:mjs|js)$/.test(ent.name))seen.push(file);
    }
  };
  await files(resolve(dist,'src'));
  let checked=0;
  for(const file of seen){
    const code=await readFile(file,'utf8');
    // Each source line: import {x} from './x.mjs' or import './x.js'.
    const importLine=/(?:^|\n)\s*import\s+(?:[^;\n]*?\s+from\s+)?['"]([.][^'"]+)['"]/g;
    for(const [,rel] of code.matchAll(importLine)){
      const target=resolve(dirname(file),rel);
      assert.ok((await stat(target)).isFile(),`Missing browser module ${rel} imported by ${file}`);
      checked++;
    }
  }
  assert.ok(checked>=5,'browser build must include its referenced modules');
  const moduleSrc=(html.match(/<script\s+type="module"\s+src="([^"]+)"/g)||[]);
  assert.equal(moduleSrc.length,1,'one explicit local app module, no inline or third-party scripts');
  assert.ok((await stat(resolve(dist,'src/app.js'))).isFile());
  assert.ok((await stat(resolve(dist,'src/styles.css'))).isFile());
  // The reader dynamically loads these, so static import checks cannot see them.
  for(const path of ['mcp-reader/worker/vendor/pdf.min.mjs','mcp-reader/worker/vendor/pdf.worker.min.mjs']){
    assert.ok((await stat(resolve(dist,path))).isFile(),`Missing browser PDF runtime ${path}`);
  }

});
