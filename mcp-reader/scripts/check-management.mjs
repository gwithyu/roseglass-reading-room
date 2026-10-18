import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../dist/server/index.js',import.meta.url),'utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ownerEnv={READER_OWNER_EMAIL:'owner@example.test'};
const ownerHeaders={'oai-authenticated-user-id':'site-owner','oai-authenticated-user-email':'owner@example.test'};
async function call(name,args={},headers={},env=ownerEnv){
 const response=await worker.fetch(new Request('https://test/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
 return (await response.json()).result;
}
test('management denies anonymous, missing identity, non-owner and disabled owner binding',async()=>{
 for(const name of ['get_development_status','read_reader_source','get_reader_settings','get_render_diagnostics']){
  for(const [headers,env] of [[{},ownerEnv],[{'oai-authenticated-user-email':'owner@example.test'},ownerEnv],[{'oai-authenticated-user-id':'other','oai-authenticated-user-email':'other@example.test'},ownerEnv],[ownerHeaders,{}]]){
   const result=await call(name,{path:'worker/reader.js'},headers,env);
   assert.equal(result.isError,true);
   assert.equal(result.structuredContent,undefined);
   assert.doesNotMatch(JSON.stringify(result),/const state|READER_DEFAULTS|owner@example/);
  }
 }
});
test('owner can read bounded deployed source; path traversal, environment and injection fail',async()=>{
 const result=await call('read_reader_source',{path:'worker/reader.js',length:80},ownerHeaders);
 assert.equal(result.isError,undefined);assert.equal(result.structuredContent.text.length,80);
 assert.equal(result.structuredContent.provenance,'deployed-build-source-snapshot');
 for(const args of [{path:'../.env'},{path:'.git/config'},{path:'worker/index.js'},{path:'worker/reader.js',length:12001},{path:'worker/reader.js',offset:-1},{path:'worker/reader.js',code:'process.env'},{path:'worker/reader.js',ownerId:'site-owner'}])assert.equal((await call('read_reader_source',args,ownerHeaders)).isError,true);
});
test('capability and DPI responses cannot claim a working build/deploy runner or client rendering',async()=>{
 const status=(await call('get_development_status',{},ownerHeaders)).structuredContent;
 assert.match(status.capabilities.publish,/unavailable/);assert.match(status.capabilities.editSource,/unavailable/);
 const diag=(await call('get_render_diagnostics',{},ownerHeaders)).structuredContent;
 assert.equal(diag.clientTelemetry,null);assert.match(diag.verification,/No real/);
 const config=(await call('get_reader_settings',{},ownerHeaders)).structuredContent;
 assert.equal(config.runtimeWritable,false);assert.equal(config.settings.fitMode,'fit-page');
 for(const name of ['update_reader_settings','publish_reader','execute_code','run_command'])assert.equal((await call(name,{},ownerHeaders)).isError,true);
});
test('existing MCP tools retain schemas and annotations; only UI version pointers advance',async()=>{
 const old=JSON.parse(await readFile(new URL('./fixtures/baseline-tools.json',import.meta.url),'utf8'));
 const current=(await (await worker.fetch(new Request('https://test/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})}))).json()).result.tools;
 assert.equal(old.length,3);
 for(const tool of old){const next=current.find(t=>t.name===tool.name);assert.ok(next);assert.deepEqual(next.inputSchema,tool.inputSchema);assert.deepEqual(next.annotations,tool.annotations);if(tool.name!=='open_reading_room')assert.deepEqual(next,tool);}
});
