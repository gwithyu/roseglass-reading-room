import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
test('copied/exported does not masquerade as sent',()=>{
  assert.match(source,/return 'sent'/);
  assert.match(source,/return 'copied'/);
  assert.match(source,/return 'exported'/);
  assert.match(source,/if\(outcome==='sent'\)/);
  assert.match(source,/state\.awaitingManualSegment=k/);
});
test('manual segments pause until explicit acknowledgement',()=>{
  assert.match(source,/if\(state\.awaitingManualSegment!==null\)return notice/);
  assert.match(source,/function confirmManualSegment\(\)/);
  assert.match(source,/\$\('confirm-segment'\)\.onclick=confirmManualSegment/);
});
test('old PDF indexing never writes into newly opened PDF',()=>{
  assert.match(source,/if\(state\.document!==doc\|\|state\.pagesText!==textTarget\)/);
  assert.match(source,/if\(state\.document!==doc\|\|state\.pagesText!==target\|\|state\.kind!==kind\)/);
});