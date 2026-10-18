import test from 'node:test';
import assert from 'node:assert/strict';
import {initAiChat} from '../src/ai-chat.mjs';

function fakeBrowser(mode,{imageData=null,getContext=null,chatFetch=null,healthFetch=null}={}){
  class Node{
    constructor(){
      this.handlers={};this.value='';this.children=[];this.checked=false;this.disabled=false;
      this.classList={add(){},remove(){}};this.dataset={};
    }
    addEventListener(name,fn){this.handlers[name]=fn;}
    async trigger(name){return this.handlers[name]?.({key:'',preventDefault(){}});}
    replaceChildren(){this.children=[];}
    append(el){this.children.push(el);}
    setAttribute(){}
    focus(){}
    click(){return this.trigger('click');}
  }
  const ids=['ai-panel','open-ai','close-ai','ai-provider','ai-model','ai-question','ai-send','ai-messages','ai-status','ai-image','ai-reset','ai-cloud-consent','ai-api-key','ai-key-wrap'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
  nodes['ai-provider'].value='ollama';
  const calls=[];
  globalThis.document={getElementById:id=>nodes[id],createElement:()=>new Node()};
  globalThis.fetch=async (url,options)=>{
    calls.push({url,options});
    if(url==='/api/health')return healthFetch?healthFetch(url,options):{ok:true,json:async()=>({mode})};
    if(url==='/api/chat')return chatFetch?chatFetch(url,options):{ok:true,json:async()=>({answer:'模拟回答'})};
    throw Error('unexpected route');
  };
  initAiChat({getContext:getContext||async()=>({documentKey:'lecture1',text:'第一页公式',image:imageData})});
  return {nodes,calls};
}
test('local mode never includes API keys and does not call AI on opening',async(t)=>{
  const doc=globalThis.document,fetchBefore=globalThis.fetch;
  t.after(()=>{globalThis.document=doc;globalThis.fetch=fetchBefore;});
  const {nodes,calls}=fakeBrowser('local-only');
  await nodes['open-ai'].trigger('click');
  assert.deepEqual(calls.map(x=>x.url),['/api/health']);
  nodes['ai-question'].value='解释一下';
  await nodes['ai-send'].trigger('click');
  assert.deepEqual(calls.map(x=>x.url),['/api/health','/api/chat']);
  assert.equal('key' in JSON.parse(calls[1].options.body),false);
  assert.equal(nodes['ai-messages'].children.length,2);
  await nodes['ai-reset'].trigger('click');
  assert.equal(nodes['ai-messages'].children.length,0);
});
test('hosted Pages BYOK mode sends user key only after explicit consent and submission',async(t)=>{
  const doc=globalThis.document,fetchBefore=globalThis.fetch;
  t.after(()=>{globalThis.document=doc;globalThis.fetch=fetchBefore;});
  const {nodes,calls}=fakeBrowser('pages-byok');
  await nodes['open-ai'].trigger('click');
  assert.equal(nodes['ai-provider'].value,'deepseek');
  assert.deepEqual(calls.map(x=>x.url),['/api/health']);
  nodes['ai-api-key'].value='test-user-12345678';
  nodes['ai-question'].value='请解释';
  await nodes['ai-send'].trigger('click');
  assert.equal(calls.length,1,'consent gate must prevent network');
  nodes['ai-cloud-consent'].checked=true;
  await nodes['ai-send'].trigger('click');
  assert.equal(calls.length,2);
  const payload=JSON.parse(calls[1].options.body);
  assert.equal(payload.key,'test-user-12345678');
  assert.equal(payload.provider,'deepseek');
  assert.equal(calls[1].options.cache,'no-store');
  await nodes['close-ai'].trigger('click');
  assert.equal(nodes['ai-api-key'].value,'','secret cleared when panel closes');
});

test('hosted UI rejects oversized PNG before sending user API key',async(t)=>{
  const doc=globalThis.document,fetchBefore=globalThis.fetch;
  t.after(()=>{globalThis.document=doc;globalThis.fetch=fetchBefore;});
  const {nodes,calls}=fakeBrowser('pages-byok',{imageData:'data:image/png;base64,'+'A'.repeat(4_300_002)});
  await nodes['open-ai'].trigger('click');
  nodes['ai-provider'].value='openai';
  await nodes['ai-provider'].trigger('change');
  nodes['ai-image'].checked=true;
  nodes['ai-cloud-consent'].checked=true;
  nodes['ai-api-key'].value='test-own-api-key-123';
  nodes['ai-question'].value='解释这张图';
  await nodes['ai-send'].trigger('click');
  assert.deepEqual(calls.map(x=>x.url),['/api/health']);
  assert.match(nodes['ai-status'].textContent,/图像超过/);
});

test('changing provider during PDF image capture never sends the old provider key to a new endpoint',async(t)=>{
  const oldDoc=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDoc;globalThis.fetch=oldFetch;});
  let finishCapture;
  const {nodes,calls}=fakeBrowser('pages-byok',{getContext:()=>new Promise(resolve=>{finishCapture=resolve;})});
  await nodes['open-ai'].trigger('click');
  nodes['ai-api-key'].value='old-deepseek-user-key';
  nodes['ai-question'].value='帮我解释这一页';
  nodes['ai-cloud-consent'].checked=true;
  const pending=nodes['ai-send'].trigger('click');
  assert.equal(typeof finishCapture,'function','capture is in progress');
  nodes['ai-provider'].value='openai';
  await nodes['ai-provider'].trigger('change');
  nodes['ai-api-key'].value='new-openai-user-key';
  finishCapture({documentKey:'lecture1',text:'已捕捉的页面文字',image:null});
  await pending;
  assert.deepEqual(calls.map(call=>call.url),['/api/health'],'no API request after provider change');
  assert.equal(nodes['ai-messages'].children.length,0,'no stale answer displayed');
});

test('changing provider during in-flight API call aborts and hides stale answer',async(t)=>{
  const oldDoc=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDoc;globalThis.fetch=oldFetch;});
  let deliverResponse;let capturedSignal;
  const {nodes,calls}=fakeBrowser('pages-byok',{chatFetch:(url,options)=>{
    capturedSignal=options.signal;
    return new Promise(resolve=>{deliverResponse=resolve;});
  }});
  await nodes['open-ai'].trigger('click');
  nodes['ai-api-key'].value='old-deepseek-user-key';
  nodes['ai-question'].value='解释第一页';
  nodes['ai-cloud-consent'].checked=true;
  const sending=nodes['ai-send'].trigger('click');
  await Promise.resolve();
  assert.equal(typeof deliverResponse,'function');
  const forwarded=JSON.parse(calls[1].options.body);
  assert.equal(forwarded.provider,'deepseek');
  assert.equal(forwarded.key,'old-deepseek-user-key');
  nodes['ai-provider'].value='openai';
  await nodes['ai-provider'].trigger('change');
  assert.equal(capturedSignal.aborted,true,'old request aborted on provider switch');
  deliverResponse({ok:true,json:async()=>({answer:'旧服务商的迟到回复'})});
  await sending;
  assert.equal(nodes['ai-messages'].children.length,0,'must not append old reply to new provider session');
  assert.equal(nodes['ai-api-key'].value,'','the old key is erased');
});

test('editing API key while PDF capture is pending prevents forwarding the previously entered key',async(t)=>{
  const oldDoc=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDoc;globalThis.fetch=oldFetch;});
  let resolvePage;
  const {nodes,calls}=fakeBrowser('pages-byok',{getContext:()=>new Promise(resolve=>{resolvePage=resolve;})});
  await nodes['open-ai'].trigger('click');
  nodes['ai-api-key'].value='first-valid-api-key';
  nodes['ai-cloud-consent'].checked=true;
  nodes['ai-question'].value='解释这个图';
  const sending=nodes['ai-send'].trigger('click');
  nodes['ai-api-key'].value='second-valid-api-key';
  await nodes['ai-api-key'].trigger('input');
  resolvePage({documentKey:'lecture1',text:'第一页',image:null});
  await sending;
  assert.deepEqual(calls.map(c=>c.url),['/api/health']);
  assert.equal(nodes['ai-messages'].children.length,0);
});

test('editing model during in-flight request cancels old response',async(t)=>{
  const oldDoc=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDoc;globalThis.fetch=oldFetch;});
  let deliver;let signal;
  const {nodes}=fakeBrowser('pages-byok',{chatFetch:async(_url,options)=>{
    signal=options.signal;
    return new Promise(resolve=>{deliver=resolve;});
  }});
  await nodes['open-ai'].trigger('click');
  nodes['ai-api-key'].value='current-valid-api-key';
  nodes['ai-cloud-consent'].checked=true;
  nodes['ai-question'].value='解释这一页';
  const sending=nodes['ai-send'].trigger('click');
  await Promise.resolve();
  assert.equal(typeof deliver,'function');
  nodes['ai-model'].value='deepseek-reasoner';
  await nodes['ai-model'].trigger('input');
  assert.equal(signal.aborted,true);
  deliver({ok:true,json:async()=>({answer:'旧模型的回复'})});
  await sending;
  assert.equal(nodes['ai-messages'].children.length,0);
});

test('closing AI panel during pending health probe cannot reopen or initialize a stale cloud session',async(t)=>{
  const oldDoc=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDoc;globalThis.fetch=oldFetch;});
  let resolveHealth;
  const {nodes,calls}=fakeBrowser('pages-byok',{healthFetch:()=>new Promise(resolve=>{resolveHealth=resolve;})});
  const opening=nodes['open-ai'].trigger('click');
  assert.equal(typeof resolveHealth,'function');
  await nodes['close-ai'].trigger('click');
  resolveHealth({ok:true,json:async()=>({mode:'pages-byok'})});
  await opening;
  assert.equal(nodes['ai-provider'].value,'ollama','stale health response must not switch provider');
  assert.deepEqual(calls.map(x=>x.url),['/api/health']);
});

test('cancelled PDF extraction unlocks new provider immediately without releasing a newer send',async(t)=>{
  const oldDoc=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDoc;globalThis.fetch=oldFetch;});
  const finishPage=[];
  const {nodes,calls}=fakeBrowser('pages-byok',{getContext:()=>new Promise(resolve=>finishPage.push(resolve))});
  await nodes['open-ai'].trigger('click');
  nodes['ai-question'].value='讲解本页';
  nodes['ai-api-key'].value='old-deepseek-key-123';
  nodes['ai-cloud-consent'].checked=true;
  const oldSend=nodes['ai-send'].trigger('click');
  assert.equal(nodes['ai-send'].disabled,true,'old capture locks its own session');
  nodes['ai-provider'].value='openai';
  await nodes['ai-provider'].trigger('change');
  assert.equal(nodes['ai-send'].disabled,false,'switching providers unlocks without waiting for stale PDF');
  nodes['ai-api-key'].value='new-openai-key-456';
  nodes['ai-cloud-consent'].checked=true;
  const newSend=nodes['ai-send'].trigger('click');
  assert.equal(finishPage.length,2,'fresh session starts while stale capture remains unresolved');
  assert.equal(nodes['ai-send'].disabled,true,'fresh capture locks button');
  finishPage[0]({documentKey:'doc',text:'stale PDF page',image:null});
  await oldSend;
  assert.equal(nodes['ai-send'].disabled,true,'old finally must never unlock active fresh session');
  finishPage[1]({documentKey:'doc',text:'new PDF page',image:null});
  await newSend;
  const aiCalls=calls.filter(c=>c.url==='/api/chat');
  assert.equal(aiCalls.length,1,'stale capture never invokes the paid AI API');
  const packet=JSON.parse(aiCalls[0].options.body);
  assert.equal(packet.provider,'openai');
  assert.equal(packet.key,'new-openai-key-456');
  assert.equal(nodes['ai-send'].disabled,false,'fresh task owns its own final cleanup');
});
