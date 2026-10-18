import test from 'node:test';
import assert from 'node:assert/strict';
import {initAiChat} from '../src/ai-chat.mjs';

test('API is never called until user explicitly submits, and browser never sends keys',async(t)=>{
  const oldDocument=globalThis.document,oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.document=oldDocument;globalThis.fetch=oldFetch;});
  class Node{
    constructor(){this.handlers={};this.value='';this.children=[];this.classList={add(){},remove(){}};this.disabled=false;this.checked=false;}
    addEventListener(name,fn){this.handlers[name]=fn;}
    async trigger(name){return this.handlers[name]?.({key:'',preventDefault(){}});}
    replaceChildren(){this.children=[];}
    append(el){this.children.push(el);}
    setAttribute(){}
    focus(){}
    click(){return this.trigger('click');}
  }
  const ids=['ai-panel','open-ai','close-ai','ai-provider','ai-model','ai-question','ai-send','ai-messages','ai-status','ai-image','ai-reset','ai-cloud-consent'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
  nodes['ai-provider'].value='ollama';
  globalThis.document={getElementById:id=>nodes[id],createElement:()=>new Node()};
  const calls=[];
  globalThis.fetch=async (url,options)=>{
    calls.push({url,options});
    if(url==='/api/health')return {ok:true,json:async()=>({mode:'local-only'})};
    if(url==='/api/chat')return {ok:true,json:async()=>({answer:'示例回答'})};
    throw new Error('unexpected network route');
  };
  initAiChat({getContext:async()=>({documentKey:'doc1',text:'第1页数学公式',image:null})});
  await nodes['open-ai'].trigger('click');
  assert.deepEqual(calls.map(c=>c.url),['/api/health']);
  nodes['ai-question'].value='为什么？';
  await nodes['ai-send'].trigger('click');
  assert.deepEqual(calls.map(c=>c.url),['/api/health','/api/chat']);
  const payload=JSON.parse(calls[1].options.body);
  assert.equal('key' in payload,false);
  assert.match(payload.messages[0].content,/数学公式/);
  assert.equal(nodes['ai-messages'].children.length,2);
  await nodes['ai-reset'].trigger('click');
  assert.equal(nodes['ai-messages'].children.length,0);
  nodes['ai-provider'].value='openai';
  await nodes['ai-provider'].trigger('change');
  nodes['ai-question'].value='Should not send with no consent';
  await nodes['ai-send'].trigger('click');
  assert.equal(calls.filter(c=>c.url==='/api/chat').length,1,'cloud should be blocked without consent');
  nodes['ai-cloud-consent'].checked=true;
  await nodes['ai-send'].trigger('click');
  assert.equal(calls.filter(c=>c.url==='/api/chat').length,2,'cloud only after consent');
});
