import test from 'node:test';
import assert from 'node:assert/strict';
import {positionKey,normalizedPosition,loadReadingPosition,saveReadingPosition,clearReadingPosition} from '../src/reading-progress.mjs';

function fakeStorage() {
  const db=new Map();
  return {getItem:k=>db.has(k)?db.get(k):null,setItem:(k,v)=>db.set(k,String(v)),removeItem:k=>db.delete(k),dump:()=>Object.fromEntries(db)};
}
const docA='f'.repeat(24), docB='a'.repeat(24);

test('same file restores independent page, fit mode and zoom after reopening',()=>{
  const store=fakeStorage();
  assert.equal(loadReadingPosition(store,docA,40),null);
  assert.ok(saveReadingPosition(store,docA,40,{page:17,zoomMode:'custom',zoom:2.4}));
  assert.deepEqual(loadReadingPosition(store,docA,40),{v:1,page:17,zoomMode:'custom',zoom:2.4});
  assert.ok(saveReadingPosition(store,docB,10,{page:4,zoomMode:'fit-width',zoom:1}));
  assert.deepEqual(loadReadingPosition(store,docB,10),{v:1,page:4,zoomMode:'fit-width',zoom:1});
  assert.equal(loadReadingPosition(store,docA,40).page,17);
  assert.equal(Object.keys(store.dump()).length,2);
  assert.ok(Object.keys(store.dump()).every(x=>!x.includes('.pdf')&&!x.includes('.pptx')));
});
test('changed content does not inherit different document progress',()=>{
  const store=fakeStorage();
  saveReadingPosition(store,docA,70,{page:50,zoomMode:'custom',zoom:2});
  assert.equal(loadReadingPosition(store,docB,70),null);
  assert.equal(positionKey('local-4096'),null);
  assert.equal(positionKey('lecture.pptx'),null);
  assert.equal(saveReadingPosition(store,null,10,{page:1,zoomMode:'custom',zoom:2}),false);
});
test('revision with fewer pages clamps old page, corrupted data cannot crash',()=>{
  const store=fakeStorage();
  saveReadingPosition(store,docA,100,{page:99,zoomMode:'custom',zoom:3});
  assert.equal(loadReadingPosition(store,docA,7).page,6);
  store.setItem(positionKey(docB),'garbled');
  assert.equal(loadReadingPosition(store,docB,7),null);
  store.setItem(positionKey(docB),JSON.stringify({v:12,page:5,zoom:2,zoomMode:'custom'}));
  assert.equal(loadReadingPosition(store,docB,7),null);
  assert.equal(normalizedPosition({v:1,page:-1,zoom:1,zoomMode:'fit-page'},4),null);
  assert.equal(normalizedPosition({v:1,page:0,zoom:Infinity,zoomMode:'fit-page'},4),null);
  assert.equal(normalizedPosition({v:1,page:0,zoom:1,zoomMode:'not-a-mode'},4),null);
  assert.equal(normalizedPosition({v:1,page:0,zoom:1,zoomMode:'fit-page'},0),null);
  assert.equal(normalizedPosition({v:1,page:1,zoom:8,zoomMode:'custom'},3).zoom,3);
  assert.equal(normalizedPosition({v:1,page:1,zoom:-2,zoomMode:'custom'},3).zoom,0.5);
});
test('reset affects only one document; bookmarks are separate',()=>{
  const store=fakeStorage();
  saveReadingPosition(store,docA,12,{page:5,zoomMode:'custom',zoom:2.1});
  saveReadingPosition(store,docB,12,{page:9,zoomMode:'fit-width',zoom:1});
  store.setItem('roseglass:v1:bookmarks:'+docA,'[4,5]');
  assert.equal(clearReadingPosition(store,docA),true);
  assert.equal(loadReadingPosition(store,docA,12),null);
  assert.equal(loadReadingPosition(store,docB,12).page,9);
  assert.equal(store.getItem('roseglass:v1:bookmarks:'+docA),'[4,5]');
});
test('disabled, quota exceeded or missing local storage never throws',()=>{
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
  for(const store of [null,blocked]){
    assert.equal(loadReadingPosition(store,docA,9),null);
    assert.equal(saveReadingPosition(store,docA,9,{page:1,zoomMode:'fit-page',zoom:1}),false);
    assert.equal(clearReadingPosition(store,docA),false);
  }
});