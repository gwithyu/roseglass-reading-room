import test from 'node:test';
import assert from 'node:assert/strict';
import {notesKey,normalizedNote,normalizeNotes,loadNotes,saveNotes} from '../src/study-notes.mjs';
function fakeStore(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),dump:()=>m};}
const a='a'.repeat(24),b='b'.repeat(24);
test('notes persist independently for files with same name',()=>{
  const s=fakeStore();const note={id:'one',page:7,x:.25,y:.67,text:'  Marginal cost  '};
  assert.ok(saveNotes(s,a,18,[note]));assert.ok(saveNotes(s,b,18,[{id:'other',page:3,x:null,y:null,text:'chapter'}]));
  assert.deepEqual(loadNotes(s,a,18),[{...note,text:'Marginal cost'}]);
  assert.equal(loadNotes(s,b,18)[0].page,3);
  assert.equal(s.dump().size,2);
});
test('bad records, out of range coordinates and duplicate IDs do not survive',()=>{
  const valid={id:'A',page:2,x:.5,y:.5,text:'valid'};
  assert.deepEqual(normalizeNotes([valid,{...valid,text:'duplicate'},{...valid,id:'off',page:99},{...valid,id:'bad',x:1.9}],6),[valid]);
  assert.equal(normalizedNote({...valid,x:null,y:.2},10),null);
  assert.equal(normalizedNote({...valid,text:88},10),null);
  assert.equal(normalizedNote({...valid,id:'<script>'},10),null);
  assert.equal(notesKey('lecture.pdf'),null);
});
test('notes are length bounded and sanitized, not tied to reading-position reset',()=>{
  const s=fakeStore(),notes=[{id:'x',page:1,x:null,y:null,text:'Q'.repeat(999)}];
  assert.ok(saveNotes(s,a,3,notes));
  assert.equal(loadNotes(s,a,3)[0].text.length,480);
  s.setItem('roseglass:v2:position:'+a,'{"v":1,"page":1}');
  s.removeItem('roseglass:v2:position:'+a);
  assert.equal(loadNotes(s,a,3).length,1);
});
test('disabled local storage and malformed JSON fail safely',()=>{
  const s=fakeStore();s.setItem(notesKey(a),'{oops');assert.deepEqual(loadNotes(s,a,10),[]);
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};
  assert.deepEqual(loadNotes(blocked,a,10),[]);
  assert.equal(saveNotes(blocked,a,10,[]),false);
  assert.equal(saveNotes(null,a,10,[]),false);
});