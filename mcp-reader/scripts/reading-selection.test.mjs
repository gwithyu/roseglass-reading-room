import test from 'node:test';
import assert from 'node:assert/strict';
import {pointFromClient, regionFromClient, validRegion, normalizedRegionToPixels, makeSelection, buildReadingMessage, captureSelectionImage} from '../worker/zoom/reading-selection-geometry.mjs';
const bounds={left:100,top:200,width:900,height:1200,right:1000,bottom:1400};
let seq=0;
const selection=(kind,opts={})=>makeSelection({kind,pageNumber:4,selectionId:`id-${++seq}`,...opts});
test('point maps visually regardless of css/page scaling',()=>{
  assert.deepEqual(pointFromClient(550,800,bounds),{x:.5,y:.5});
  assert.deepEqual(pointFromClient(325,500,{left:100,top:200,width:450,height:600}),{x:.5,y:.5});
});
test('out-of-page pointer clamped',()=>assert.deepEqual(pointFromClient(-100,1900,bounds),{x:0,y:1}));
test('invalid page bounds and nonfinite pointer rejected',()=>{
  assert.throws(()=>pointFromClient(5,4,{left:0,top:0,width:0,height:2}),RangeError);
  assert.throws(()=>pointFromClient(NaN,3,bounds),TypeError);
});
test('bottom right drag yields same canonical region as reverse direction',()=>{
  const a=regionFromClient({x:190,y:440},{x:820,y:1160},bounds);
  const b=regionFromClient({x:820,y:1160},{x:190,y:440},bounds);
  assert.deepEqual(a,b);
  assert.ok(Math.abs(a.x-.1)<1e-9 && Math.abs(a.y-.2)<1e-9);
  assert.ok(Math.abs(a.width-.7)<1e-9 && Math.abs(a.height-.6)<1e-9);
});
test('region crossing page boundary clamps',()=>{
  assert.deepEqual(regionFromClient({x:550,y:800},{x:1200,y:100},bounds),{x:.5,y:0,width:.5,height:.5});
});
test('tiny accidental drag rejected',()=>{
  assert.equal(validRegion({x:.5,y:.5,width:.001,height:.2}),false);
  assert.equal(validRegion({x:.1,y:.2,width:.35,height:.5}),true);
});
test('region image crop uses physical canvas pixels, not CSS bounds',()=>{
  assert.deepEqual(normalizedRegionToPixels({x:.25,y:.2,width:.5,height:.6},2400,3600),{x:600,y:720,width:1200,height:2160});
});
test('micro crop has minimum one source pixel',()=>{
  assert.deepEqual(normalizedRegionToPixels({x:.999,y:.999,width:.001,height:.001},100,100),{x:99,y:99,width:1,height:1});
});
test('selection schema distinguishes point and region and full page',()=>{
  assert.deepEqual(Object.keys(selection('page')).sort(),['documentFingerprint','kind','pageNumber','schema','selectionId']);
  assert.equal(selection('region',{region:{x:.1,y:.2,width:.4,height:.3}}).region.width,.4);
  assert.equal(selection('point',{point:{x:.5,y:.7}}).point.y,.7);
});
test('selection rejects invalid coordinates or wrong page',()=>{
  assert.throws(()=>selection('point',{point:{x:1.2,y:.5}}),RangeError);
  assert.throws(()=>selection('region',{region:{x:.9,y:.5,width:.4,height:.3}}),RangeError);
  assert.throws(()=>makeSelection({kind:'page',pageNumber:0,selectionId:'a'}),RangeError);
});
test('region sends selected region text PLUS whole page context',()=>{
  const s=selection('region',{region:{x:.1,y:.1,width:.7,height:.6}});
  const message=buildReadingMessage(s,{fileName:'Finance I.pdf',pageText:'Full page 4 notes',regionText:'Selected ROI',totalPages:58,imageDelivery:{page:true,region:true}});
  assert.match(message,/框选区提取文字：[\s\S]*Selected ROI/);
  assert.match(message,/当前页完整文字[\s\S]*Full page 4 notes/);
  assert.match(message,/图像上传回执：整页已确认；选区已确认/);
  assert.match(message,/4 \/ 58/);
});
test('page selection asks for full slide not near single point',()=>{
  const message=buildReadingMessage(selection('page'),{pageText:'Entire slide text'});
  assert.match(message,/整页（完整讲解整页）/);
  assert.doesNotMatch(message,/附近文字（仅作辅助/);
});
test('no image does not claim host can see pixels',()=>{
  assert.match(buildReadingMessage(selection('page'),{pageText:'words only'}),/图像上传尚未确认/);
});
test('crops PDF.js framebuffer and returns image PNG, no old pin is painted',async()=>{
  let cropArgs=null;
  const source={width:2400,height:3200};
  const fakeFactory=(width,height)=>({width,height,getContext:()=>({drawImage:(...args)=>{cropArgs=args;}}),toBlob:callback=>callback(new Blob(['png'],{type:'image/png'}))});
  const region=selection('region',{region:{x:.25,y:.5,width:.5,height:.25}});
  const result=await captureSelectionImage(source,region,{createCanvas:fakeFactory});
  assert.deepEqual(result.sourceRect,{x:600,y:1600,width:1200,height:800});
  assert.deepEqual(cropArgs,[source,600,1600,1200,800,0,0,1200,800]);
  assert.equal(result.blob.type,'image/png');
});
test('whole page capture keeps full resolution',async()=>{
  const source={width:4000,height:3000};
  const cap=await captureSelectionImage(source,selection('page'),{createCanvas:(w,h)=>({width:w,height:h,getContext:()=>({drawImage:()=>{}}),toBlob:cb=>cb(new Blob(['ok']))})});
  assert.deepEqual(cap.sourceRect,{x:0,y:0,width:4000,height:3000});
});
test('refuses missing image encoder instead of falsely declaring success',async()=>{
  await assert.rejects(()=>captureSelectionImage({width:100,height:100},selection('page'),{createCanvas:()=>({getContext:()=>({drawImage:()=>{}})})}),/toBlob unavailable/);
});
test('zoom default is fit-page and picker remains available',async()=>{
  const fs=await import('node:fs/promises');
  const content=await fs.readFile(new URL('../worker/reader-settings.mjs',import.meta.url),'utf8');
  assert.match(content,/fitMode: 'fit-page'/);
  assert.match(await fs.readFile(new URL("../worker/ui.html",import.meta.url),"utf8"),/value="fit-width"/);
});

test('an unacknowledged selection crop is disclosed separately from a confirmed page image',()=>{
  const s=selection('region',{region:{x:.1,y:.2,width:.4,height:.4}});
  const msg=buildReadingMessage(s,{pageText:'context',imageDelivery:{page:true,region:false}});
  assert.match(msg,/整页已确认；选区未确认/);
  assert.match(msg,/当前聊天实际收到的图像/);
});
test('selection persists full-page text even when only point is chosen',()=>{
  const msg=buildReadingMessage(selection('point',{point:{x:.1,y:.4}}),{nearbyText:'only one word',pageText:'full page context'});
  assert.match(msg,/点击附近文字（仅作辅助/);
  assert.match(msg,/当前页完整文字[\s\S]*full page context/);
});
