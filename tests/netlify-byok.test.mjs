import test from 'node:test';
import assert from 'node:assert/strict';
import chat,{config as chatConfig} from '../netlify/functions/chat.mjs';
import health,{config as healthConfig} from '../netlify/functions/health.mjs';
import {readFile} from 'node:fs/promises';

test('Netlify function endpoints map to the exact public Roseglass API paths',async()=>{
  assert.equal(chatConfig.path,'/api/chat');
  assert.equal(healthConfig.path,'/api/health');
  const ok=await health(new Request('https://reader-test.netlify.app/api/health'));
  assert.equal(ok.status,200);
  const status=await ok.json();
  assert.equal(status.mode,'pages-byok');
  const denied=await health(new Request('https://reader-test.netlify.app/api/health',{method:'POST'}));
  assert.equal(denied.status,405);
});
test('Netlify BYOK forwards only the provided user credential, never a shared secret',async(t)=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer test-user-private-key');
    return new Response(JSON.stringify({choices:[{message:{content:'自费 API 模拟回复'}}]}),{status:200});
  };
  t.after(()=>{globalThis.fetch=previous;});
  const input={provider:'deepseek',model:'deepseek-chat',key:'test-user-private-key',messages:[{role:'user',content:'数学题怎么解？'}]};
  const req=new Request('https://reader-test.netlify.app/api/chat',{
    method:'POST',
    headers:{'Origin':'https://reader-test.netlify.app','Content-Type':'application/json','Sec-Fetch-Site':'same-origin'},
    body:JSON.stringify(input)
  });
  const result=await chat(req);
  assert.equal(result.status,200);
  assert.equal((await result.json()).answer,'自费 API 模拟回复');
  assert.equal(calls,1);
});
test('Netlify refuses foreign-origin requests before forwarding credentials',async(t)=>{
  const previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('Should not call paid API');};
  t.after(()=>{globalThis.fetch=previous;});
  const request=new Request('https://reader-test.netlify.app/api/chat',{
    method:'POST',
    headers:{'Origin':'https://attacker.test','Content-Type':'application/json'},
    body:JSON.stringify({provider:'deepseek',model:'deepseek-chat',key:'test-user-private-key',messages:[{role:'user',content:'Hello'}]})
  });
  const response=await chat(request);
  assert.equal(response.status,403);
  assert.equal(calls,0);
});
test('Netlify project configuration never connects a GitHub build or owner API token',async()=>{
  const raw=await readFile(new URL('../netlify.toml',import.meta.url),'utf8');
  assert.match(raw,/publish = "dist-public"/);
  assert.match(raw,/functions = "netlify\/functions"/);
  assert.match(raw,/Content-Security-Policy/);
  assert.match(raw,/connect-src 'self'/);
  assert.doesNotMatch(raw,/OPENAI_API_KEY|DEEPSEEK_API_KEY|CLOUDFLARE_API_TOKEN|github-actions/i);
});

test('preview helper cannot perform accidental production deployment',async()=>{
  const script=await readFile(new URL('../scripts/preview-netlify.sh',import.meta.url),'utf8');
  assert.match(script,/node --test/);
  assert.match(script,/scripts\/build-public\.mjs/);
  assert.match(script,/read -r -p .*YES/);
  assert.doesNotMatch(script,/--allow-anonymous/);
  assert.match(script,/Netlify Functions require an authenticated Netlify account/);
  assert.match(script,/--no-build/);
  assert.doesNotMatch(script,/(?:^|[\s])--prod(?:\s|$)/m);
});
