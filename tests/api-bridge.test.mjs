import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, invokeModel, startServer } from '../local-api/server.mjs';

const example={provider:'ollama',model:'llava',messages:[{role:'user',content:'解释公式'}]};
test('no key required for local Ollama; cloud keys required',()=>{
  assert.equal(validateChat(example).provider.needsKey,false);
  assert.throws(()=>validateChat({...example,provider:'__proto__'}),/不支持/);
  assert.throws(()=>validateChat({...example,provider:'openai'}),/API Key/);
  assert.throws(()=>validateChat({...example,provider:'deepseek',image:'data:image/png;base64,YQ==',key:'secret1234'}),/图片/);
  assert.throws(()=>validateChat({...example,model:'https://evil.site/?'}),/模型名称/);
});
test('image reaches only vision providers; mocked upstream avoids all API charges',async()=>{
  let called=0;
  const answer=await invokeModel({...example,image:'data:image/png;base64,YQ=='},{fetchImpl:async(url,opts)=>{
    called++;
    assert.equal(url,'http://127.0.0.1:11434/v1/chat/completions');
    const request=JSON.parse(opts.body);
    assert.equal(request.messages[0].content[1].type,'image_url');
    assert.equal(opts.headers.Authorization,undefined);
    return {ok:true,json:async()=>({choices:[{message:{content:'这是一个图形'}}]})};
  }});
  assert.equal(answer,'这是一个图形');assert.equal(called,1);
});
test('local-only HTTP server blocks cross-origin and uses only server-side keys',async(t)=>{
  const port=18787;
  const server=await startServer({port,keys:{openai:'server-secret-1234'},fetchImpl:async(url,opts)=>{
    if(url.includes('openai.com')) assert.equal(opts.headers.Authorization,'Bearer server-secret-1234');
    return {ok:true,json:async()=>({choices:[{message:{content:'mocked'}}]})};
  }});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${port}`;
  const health=await fetch(base+'/api/health');assert.equal((await health.json()).mode,'local-only');
  const body=JSON.stringify(example);
  const forbidden=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example'},body});
  assert.equal(forbidden.status,403);
  const success=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body});
  assert.equal((await success.json()).answer,'mocked');
  const cloud=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...example,provider:'openai',model:'gpt-4.1-mini',key:'untrusted-browser-key'})});
  assert.equal((await cloud.json()).answer,'mocked');
  const code=await fetch(base+'/local-api/server.mjs');assert.equal(code.status,404);
  const index=await fetch(base+'/');assert.equal(index.status,200);
});
