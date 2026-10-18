import test from 'node:test';
import assert from 'node:assert/strict';
import {handleChat,validateRequest} from '../functions/api/chat.js';
import {onRequestGet as health} from '../functions/api/health.js';

function request(payload,{origin='https://roseglass-test.pages.dev',method='POST'}={}){
  const headers={'Content-Type':'application/json'};
  if(origin)headers.Origin=origin;
  return new Request('https://roseglass-test.pages.dev/api/chat',{
    method,headers,body:method==='POST'?JSON.stringify(payload):undefined
  });
}
const base={provider:'deepseek',model:'deepseek-chat',key:'user-key-placeholder',messages:[{role:'user',content:'请解释第一页'}]};

test('Pages capability endpoint and missing Origin rejected',async()=>{
  const reply=await health();assert.equal((await reply.json()).mode,'pages-byok');
  let upstream=0;
  const rejected=await handleChat(request(base,{origin:''}),{fetchImpl:async()=>{upstream++;throw Error('NO');}});
  assert.equal(rejected.status,403);assert.equal(upstream,0);
});
test('fixed cloud host allowlist rejects arbitrary endpoints',()=>{
  assert.throws(()=>validateRequest({...base,provider:'http://127.0.0.1:11434'}),/服务商/);
  assert.throws(()=>validateRequest({...base,provider:'__proto__'}),/服务商/);
  assert.throws(()=>validateRequest({...base,model:'https://bad.site/?x=1'}),/模型/);
  assert.throws(()=>validateRequest({...base,key:''}),/API Key/);
  assert.throws(()=>validateRequest({...base,image:'data:image/png;base64,YQ=='}),/不支持图片/);
});
test('trusted BYOK sends personal key only to fixed upstream',async()=>{
  let count=0;
  const res=await handleChat(request({...base,provider:'openai',model:'gpt-4.1-mini'}),{
    fetchImpl:async(url,opts)=>{
      count++;
      assert.equal(url,'https://api.openai.com/v1/chat/completions');
      assert.equal(opts.headers.Authorization,'Bearer user-key-placeholder');
      assert.equal(JSON.parse(opts.body).messages[0].content,'请解释第一页');
      return new Response(JSON.stringify({choices:[{message:{content:'先计算 NPV…'}}]}),{status:200});
    }
  });
  assert.equal(res.status,200);assert.equal((await res.json()).answer,'先计算 NPV…');
  assert.equal(count,1);assert.match(res.headers.get('Cache-Control'),/no-store/);
});
test('provider errors hide upstream response and credential',async()=>{
  const res=await handleChat(request(base),{
    fetchImpl:async()=>new Response('secret: user-key-placeholder',{status:401})
  });
  assert.equal(res.status,502);
  const body=JSON.stringify(await res.json());
  assert.doesNotMatch(body,/user-key-placeholder/);
  assert.match(body,/401/);
});
