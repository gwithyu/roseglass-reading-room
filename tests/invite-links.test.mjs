import test from 'node:test';
import assert from 'node:assert/strict';
import {createInviteUrl,parseInviteId,isShareablePage,initInviteLinks} from '../src/invite-links.mjs';

function deterministicCrypto(){
  let generation=0;
  return {getRandomValues(bytes){generation++;for(let i=0;i<bytes.length;i++)bytes[i]=(i+generation*13)%256;return bytes;}};
}
test('fixed HTTPS entry generates distinct random URLs without carrying query strings',()=>{
  const crypto=deterministicCrypto();
  const a=createInviteUrl('https://roseglass.example.org/reader/?secret=do-not-copy#old',crypto);
  const b=createInviteUrl('https://roseglass.example.org/reader/?secret=do-not-copy#old',crypto);
  assert.notEqual(a,b);
  assert.match(a,/^https:\/\/roseglass\.example\.org\/reader\/#rg-invite=[0-9a-f]{32}$/);
  assert.ok(parseInviteId(new URL(a).hash));
  assert.equal(parseInviteId('#rg-invite=wrong'),null);
  assert.doesNotMatch(a,/secret=|do-not-copy|#old/);
});
test('do not offer share links for localhost, HTTP or a local file',()=>{
  for(const url of ['http://127.0.0.1:8787/','http://localhost:8787/','http://roseglass.example/','file:///tmp/index.html','https://roseglass.local/']){
    assert.equal(isShareablePage(url),false,url);
  }
  assert.equal(isShareablePage('https://roseglass.example.org/'),true);
});
test('invite UI copies only generated URL, not document or API credentials',async()=>{
  class Node{
    constructor(){
      this.handlers={};this.value='';this.disabled=false;this.textContent='';this.focused=false;
      const states=new Set(['hidden']);
      this.classList={add:c=>states.add(c),remove:c=>states.delete(c),contains:c=>states.has(c)};
    }
    addEventListener(name,fn){this.handlers[name]=fn;}
    async trigger(name){return this.handlers[name]?.({key:'Escape',preventDefault(){}});}
    setAttribute(){}
    focus(){this.focused=true;}
    select(){this.focused=true;}
    click(){return this.trigger('click');}
  }
  const ids=['invite-create','invite-panel','invite-close','invite-regenerate','invite-copy','invite-url','invite-status','invite-intro'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
  let clipboardContent=null;
  initInviteLinks({
    documentRef:{getElementById:id=>nodes[id]},
    locationRef:{href:'https://reader.example.org/index.html#rg-invite=00000000000000000000000000000000',hash:'#rg-invite=00000000000000000000000000000000'},
    cryptoProvider:deterministicCrypto(),
    clipboard:{writeText:async text=>{clipboardContent=text;}}
  });
  assert.equal(nodes['invite-intro'].classList.contains('hidden'),false);
  assert.equal(clipboardContent,null);
  await nodes['invite-create'].trigger('click');
  const first=nodes['invite-url'].value;
  assert.match(first,/^https:\/\/reader\.example\.org\/index\.html#rg-invite=[0-9a-f]{32}$/);
  await nodes['invite-regenerate'].trigger('click');
  assert.notEqual(first,nodes['invite-url'].value);
  await nodes['invite-copy'].trigger('click');
  assert.equal(clipboardContent,nodes['invite-url'].value);
  await nodes['invite-close'].trigger('click');
  assert.equal(nodes['invite-panel'].classList.contains('hidden'),true);
});
test('localhost reader never produces an unusable share URL',async()=>{
  class Node{constructor(){this.handlers={};this.value='';this.disabled=false;this.classList={add(){},remove(){}};}
    addEventListener(n,fn){this.handlers[n]=fn;}async trigger(n){return this.handlers[n]?.({preventDefault(){}});}
    setAttribute(){}focus(){}select(){}click(){return this.trigger('click');}}
  const ids=['invite-create','invite-panel','invite-close','invite-regenerate','invite-copy','invite-url','invite-status','invite-intro'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
  initInviteLinks({documentRef:{getElementById:id=>nodes[id]},locationRef:{href:'http://127.0.0.1:8787/',hash:''},cryptoProvider:deterministicCrypto()});
  await nodes['invite-create'].trigger('click');
  assert.equal(nodes['invite-url'].value,'');
  assert.equal(nodes['invite-copy'].disabled,true);
  assert.match(nodes['invite-status'].textContent,/本机/);
});
