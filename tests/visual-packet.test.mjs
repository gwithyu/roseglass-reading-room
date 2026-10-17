import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makePageImage,canvasPngBlob,samePageSnapshot,buildVisualPrompt,exportSize} from '../src/visual-packet.mjs';

test('exports portrait and widescreen with bounded dimensions for readable page pixels',()=>{
  const wide=exportSize(1920,1080), tall=exportSize(612,792);
  assert.ok(wide.width>=2000 && wide.width/wide.height>1.7);
  assert.ok(tall.height===2400 && tall.width/tall.height>.7);
  assert.ok(wide.width*wide.height<=4_500_000 && tall.width*tall.height<=4_500_000);
});
test('marks normalized coordinates on the actual image, not the surrounding glass UI',()=>{
  const ops=[];
  const ctx={fillRect:(...a)=>ops.push(['fill',...a]),drawImage:(...a)=>ops.push(['draw',...a]),beginPath:()=>{},arc:(...a)=>ops.push(['arc',...a]),stroke:()=>{},moveTo:()=>{},lineTo:()=>{}};
  const maker=()=>({width:0,height:0,getContext:()=>ctx});
  const img=makePageImage({width:1600,height:900},{x:.25,y:.75},maker);
  assert.equal(img.width,1600);assert.equal(img.height,900);
  assert.deepEqual(ops.find(x=>x[0]==='arc').slice(1,3),[400,675]);
  assert.ok(ops.find(x=>x[0]==='draw'));
  const ops2=[];
  const img2=makePageImage({width:3200,height:1800},null,()=>({getContext:()=>({fillRect:()=>{},drawImage:()=>ops2.push('draw')})}));
  assert.equal(img2.width,2400);assert.equal(img2.height,1350);
  assert.equal(ops2.length,1);
});
test('never reuse a rendered image after navigation or file switch',()=>{
  const original={fileKey:'fingerprint',page:2,kind:'pdf',renderToken:7};
  assert.equal(samePageSnapshot(original,{...original}),true);
  assert.equal(samePageSnapshot(original,{...original,page:3}),false);
  assert.equal(samePageSnapshot(original,{...original,fileKey:'other'}),false);
  assert.equal(samePageSnapshot(original,{...original,renderToken:8}),false);
  assert.equal(samePageSnapshot({fileKey:null,page:0,kind:'pdf',renderToken:1},{fileKey:null,page:0,kind:'pdf',renderToken:1}),true);
});
test('honestly describes whether image was actually attached',()=>{
  assert.match(buildVisualPrompt('KEY: TEST',true),/先确认你是否实际看到了图像像素/);
  assert.match(buildVisualPrompt('KEY: TEST',false),/尚未向 ChatGPT 附加图像/);
});
test('PNG encoding failure never claims success and browser security errors have a helpful fallback',async()=>{
  await assert.rejects(canvasPngBlob({toBlob(cb){cb(null);}}),/PNG 编码失败/);
  await assert.rejects(canvasPngBlob({toBlob(){const err=new Error('Tainted');err.name='SecurityError';throw err;}}),/手动截图上传/);
  assert.equal((await canvasPngBlob({toBlob(cb){cb({type:'image/png',size:150});}})).size,150);
});