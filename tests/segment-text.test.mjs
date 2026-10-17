import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTextChunks} from '../src/segment-text.mjs';
const reference=pages=>pages.map((p,i)=>`\n\n===== 第 ${i+1} 页 =====\n${p||'（无可提取文字）'}`).join('');
test('short pages preserve page markers in original order',()=>{
  const p=['first','second','third'];const chunks=buildTextChunks(p,70);
  assert.equal(chunks.map(c=>c.text).join(''),reference(p));
  assert.ok(chunks.every(c=>c.text.length<=70));
  assert.deepEqual([chunks[0].from,chunks.at(-1).to],[1,3]);
});
test('huge page split preserves exact content even between short pages',()=>{
  const p=['hello','🐰'.repeat(9000),'last'];const chunks=buildTextChunks(p,801);
  assert.ok(chunks.length>15);
  assert.equal(chunks.map(c=>c.text).join(''),reference(p));
  assert.ok(chunks.every(c=>c.text.length<=801));
  assert.ok(chunks.every(c=>![...c.text].includes('\uFFFD')));
  for(let i=0;i<chunks.length-1;i++) {
    const last=chunks[i].text.charCodeAt(chunks[i].text.length-1);
    assert.ok(!(last>=0xD800&&last<=0xDBFF),'must not split emoji surrogate pair');
  }
});
test('empty and no-text pages have unambiguous page markers',()=>{
 const p=['','readable',''];const cs=buildTextChunks(p,64);
 assert.equal(cs.map(c=>c.text).join(''),reference(p));
 assert.deepEqual(buildTextChunks([],90),[]);
 assert.throws(()=>buildTextChunks(p,2));
});