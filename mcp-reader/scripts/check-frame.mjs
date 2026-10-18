import test from 'node:test';
import assert from 'node:assert/strict';
import {pageFrameSize} from '../worker/zoom/reader-frame.mjs';

for (const [label,w,h,available,cap] of [
  ['landscape slide',1600,900,1020,560],
  ['portrait page',595,842,1020,560],
  ['mobile slide',1600,900,360,420],
  ['mobile portrait',595,842,360,420],
]) test(label+' frame follows rendered page',()=>{
  const frame=pageFrameSize(w,h,available,cap,12);
  assert.ok(frame.width<=available+1e-7);
  assert.ok(frame.height<=cap+1e-7);
  assert.ok(Math.abs((frame.width-24)/(frame.height-24)-w/h)<1e-10);
  assert.ok(frame.width-24>0 && frame.height-24>0);
});
test('invalid bounds do not produce stale frame',()=>{
  assert.throws(()=>pageFrameSize(1600,0,800,560,12),RangeError);
  assert.throws(()=>pageFrameSize(1600,900,20,560,12),RangeError);
});
