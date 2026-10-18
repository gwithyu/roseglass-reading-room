import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
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
  assert.match(html,/id="ai-api-key" type="password"/);
  assert.match(html,/id="invite-panel"/);
  assert.match(html,/accept=".pdf,application\/pdf"/);
  assert.doesNotMatch(html,/accept=".pdf,.pptx/);
  assert.match(html,/id="send-chat" class="bottom-button primary hidden"/);
  assert.match(html,/id="send-vision" class="soft-button vision-primary hidden"/);
  for(const path of ['LICENSE','THIRD_PARTY_NOTICES.md','mcp-reader/worker/vendor/pdf.min.mjs','mcp-reader/worker/vendor/pdf.worker.min.mjs']){
    assert.ok((await stat(resolve(dist,path))).isFile(),path);
  }
  await assert.rejects(stat(resolve(dist,'local-api/server.mjs')));
  await assert.rejects(stat(resolve(dist,'.github/workflows/release.yml')));
});
