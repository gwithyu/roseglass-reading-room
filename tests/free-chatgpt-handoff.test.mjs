import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPageContext,handoffMode} from '../src/free-chatgpt-handoff.mjs';

test('standalone is a clipboard handoff and does not assume ChatGPT app access',()=>{
  assert.equal(handoffMode(undefined),'copy');
  assert.equal(handoffMode({}),'copy');
  assert.equal(handoffMode({sendFollowUpMessage:'yes'}),'copy');
  assert.equal(handoffMode({sendFollowUpMessage:()=>{}}),'embedded');
});
test('packet includes selected page, coordinate and relevant annotation only',()=>{
  const s=buildPageContext({fileName:'Example.pdf',kind:'pdf',pageIndex:2,pageCount:12,text:'supply and demand',
    selected:{page:2,x:0.25,y:0.75},
    notes:[{page:2,x:0.25,y:0.75,text:'explain curve'},{page:1,x:null,y:null,text:'other slide'}]});
  assert.match(s,/第 3 \/ 12 页/);
  assert.match(s,/0.2500, 0.7500/);
  assert.match(s,/supply and demand/);
  assert.match(s,/explain curve/);
  assert.doesNotMatch(s,/other slide/);
});
test('image-only slide is identified as missing image and has no fabricated diagram content',()=>{
  const s=buildPageContext({fileName:'photo.pptx',kind:'pptx',pageIndex:0,pageCount:1,text:'',selected:{page:1,x:.5,y:.5}});
  assert.match(s,/图像需要另行附上/);
  assert.doesNotMatch(s,/归一化坐标/);
});
