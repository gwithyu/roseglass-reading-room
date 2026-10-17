import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeChallenge,paintChallenge,BLIND_PROMPT} from '../src/vision-challenge.mjs';
import {relayImageToChat} from '../src/chat-image-bridge.mjs';
const blob=new Blob(['PNG'],{type:'image/png'});
test('blind challenge has no KEY/color/shape answer in the model prompt',()=>{
  const spec=makeChallenge(()=>.15);
  assert.match(spec.key,/^[A-Z]{5}-\d{3}$/);
  assert.equal(spec.quadrants.length,4);
  assert.equal(new Set(spec.quadrants.map(c=>c[0])).size,4);
  assert.ok(!BLIND_PROMPT.includes(spec.key));
  for(const word of ['玫瑰红','青绿色','金黄色','紫色','菱形','三角形','五角星','圆形'])assert.ok(!BLIND_PROMPT.includes(word));
});
test('challenge draws its KEY exclusively as canvas pixels, never as DOM text',()=>{
  const calls=[];
  const ctx={fillRect:(...x)=>calls.push(['fillRect',...x]),fillText:(...x)=>calls.push(['fillText',...x]),beginPath:()=>{},moveTo:()=>{},lineTo:()=>{},closePath:()=>{},stroke:()=>{},arc:()=>{calls.push(['arc'])},strokeRect:()=>{},fill:()=>{}};
  const canvas={getContext:()=>ctx};
  const spec=makeChallenge(()=>.13);
  paintChallenge(canvas,spec);
  assert.deepEqual([canvas.width,canvas.height],[1600,900]);
  assert.ok(calls.some(c=>c[0]==='fillText'&&c[1].includes(spec.key)));
  assert.equal(calls.filter(c=>c[0]==='fillRect').length,5);
});
test('unsupported ChatGPT host returns manual fallback, no false success',async()=>{
  const r=await relayImageToChat({host:{},blob,fileName:'challenge.png',prompt:BLIND_PROMPT});
  assert.equal(r.status,'manual_required');assert.equal(r.stage,'capability');
});
test('successful upload and follow-up is only REQUESTED, never vision-verified',async()=>{
  const stages=[];let imageFileState,followupPrompt;
  const host={uploadFile:async(file,opts)=>{assert.equal(file.type,'image/png');assert.equal(opts.library,false);return {fileId:'file_test'};},
    setWidgetState:async s=>{imageFileState=s;},
    sendFollowUpMessage:async p=>{followupPrompt=p.prompt;}};
  const r=await relayImageToChat({host,blob,fileName:'test.png',prompt:BLIND_PROMPT,onPhase:s=>stages.push(s)});
  assert.equal(r.status,'followup_requested');
  assert.deepEqual(stages,['uploaded','linked','followup_requested']);
  assert.deepEqual(imageFileState.imageIds,['file_test']);
  assert.equal(followupPrompt,BLIND_PROMPT);
});
test('switch after upload cancels stale challenge before widget state or followup',async()=>{
  let seq=3,calls=0;
  const host={uploadFile:async()=>{seq=4;return {fileId:'file_test'};},setWidgetState:()=>{calls++},sendFollowUpMessage:()=>{calls++}};
  const r=await relayImageToChat({host,blob,fileName:'test.png',prompt:BLIND_PROMPT,canProceed:()=>seq===3});
  assert.equal(r.status,'cancelled');assert.equal(calls,0);
});
test('failed upload cannot accidentally send a text-only challenge claiming image receipt',async()=>{
  let followups=0;
  const host={uploadFile:async()=>{throw Error('host rejected')},setWidgetState:()=>{},sendFollowUpMessage:()=>{followups++}};
  const r=await relayImageToChat({host,blob,fileName:'test.png',prompt:BLIND_PROMPT});
  assert.equal(r.status,'manual_required');assert.equal(followups,0);assert.equal(r.stage,'start');
});
test('failed image state / followup are both reported as fallback, not verified',async()=>{
  const host={uploadFile:async()=>({fileId:'f'}),setWidgetState:async()=>{throw Error('widget state rejected')},sendFollowUpMessage:async()=>{}};
  const fail=await relayImageToChat({host,blob,fileName:'test.png',prompt:BLIND_PROMPT});
  assert.equal(fail.status,'manual_required');assert.equal(fail.stage,'uploaded');
  host.setWidgetState=async()=>{};
  host.sendFollowUpMessage=async()=>{throw Error('no conversation')};
  const fail2=await relayImageToChat({host,blob,fileName:'test.png',prompt:BLIND_PROMPT});
  assert.equal(fail2.status,'manual_required');assert.equal(fail2.stage,'linked');
});