import test from 'node:test';
import assert from 'node:assert/strict';
import {initAiChat} from '../src/ai-chat.mjs';

function fakeBrowser(mode,{imageData=null}={}){
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
    if(url==='/api/health')return {ok:true,json:async()=>({mode})};
    if(url==='/api/chat')return {ok:true,json:async()=>({answer:'模拟回答'})};
    throw Error('unexpected route');
  };
  initAiChat({getContext:async()=>({documentKey:'lecture1',text:'第一页公式',image:imageData})});
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
