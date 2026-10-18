import test from 'node:test';
import assert from 'node:assert/strict';
import {fitScales,getScale,renderRatio,clientToPagePoint,desiredScrollToCenter} from '../worker/zoom/reader-geometry.mjs';
test('16:9 slide fit width keeps ratio and fills available width',()=>{const f=fitScales(1600,900,1000,650,12);assert.equal(f.fitWidth,976/1600);assert.equal(1600*f.fitWidth / (900*f.fitWidth),16/9);});
test('fit page is always smaller or equal than fit width',()=>{const f=fitScales(1600,900,1000,400,12);assert.ok(f.fitPage<=f.fitWidth);});
test('zoom uses PDF page proportions, not a stretched bitmap',()=>{const s=getScale('custom',2,1600,900,1000,650,12);assert.equal(s,2*fitScales(1600,900,1000,650,12).fitPage);});
test('high DPI render honors memory budget',()=>{const d=renderRatio(3000,1700,3,16e6);assert.ok(d<3);assert.ok(d*d*3000*1700<=16e6+1);});
test('click position normalized regardless of CSS zoom and scroll',()=>{for(const size of [400,800,1600]){const p=clientToPagePoint(100+size*.6525,50+size*.3787,{left:100,top:50,width:size,height:size});assert.ok(Math.abs(p.x-.6525)<1e-9);assert.ok(Math.abs(p.y-.3787)<1e-9);}});
test('zoom scroll anchor preserves center',()=>{const p=desiredScrollToCenter({x:.5,y:.5},0,0,1600,900,800,500);assert.deepEqual(p,{left:400,top:200});});
test('invalid page dimensions fail',()=>assert.throws(()=>fitScales(0,100,500,400),/Invalid/));



import {readFileSync} from 'node:fs';
import {miniMarkerGeometry,drawMiniFocusMarker} from '../worker/zoom/reading-focus-marker.mjs';

test('marker stays tiny in the actual 817px co-reading PNG',()=>{
  const p=miniMarkerGeometry(817,459,{x:.6525,y:.3787});
  assert.ok(p.radius<5);
  assert.equal(p.x,533);
  assert.equal(p.y,174);
});
test('marker remains bounded on a high resolution exported page',()=>{
  const p=miniMarkerGeometry(2400,1350,{x:.5,y:.5});
  assert.ok(p.radius<=10);
});
test('invalid or missing point does not draw a dot',()=>{
  assert.equal(miniMarkerGeometry(817,459,{x:-1,y:.5}),null);
  assert.equal(miniMarkerGeometry(817,459,null),null);
  assert.throws(()=>miniMarkerGeometry(0,459,{x:.5,y:.5}),/Invalid/);
});
test('focus painter draws just two compact discs, no crosshair',()=>{
  const calls=[];
  const ctx={save:()=>calls.push(['save']),restore:()=>calls.push(['restore']),
    beginPath:()=>calls.push(['begin']),arc:(...p)=>calls.push(['arc',...p]),fill:()=>calls.push(['fill'])};
  assert.equal(drawMiniFocusMarker(ctx,817,459,{x:.25,y:.5}),true);
  const arcs=calls.filter(c=>c[0]==='arc');
  assert.equal(arcs.length,2);
  assert.ok(arcs.every(a=>a[3]<7));
  assert.equal(drawMiniFocusMarker(ctx,817,459,null),false);
});
test('integrated marker is 9px and does not capture clicks',()=>{
 const html=readFileSync(new URL('../worker/ui.html',import.meta.url),'utf8');
 assert.match(html, /#pin \{ width: 9px; height: 9px;/);
 assert.match(html, /pointer-events: none;/);
});
