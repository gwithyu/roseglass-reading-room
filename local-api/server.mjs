/** Roseglass public BYOK bridge. Local-only; no shared service, analytics or key storage. */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 12 * 1024 * 1024;
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf'};
export const PROVIDERS = Object.freeze({
  ollama: { endpoint:'http://127.0.0.1:11434/v1/chat/completions', defaultModel:'llava', vision:true, needsKey:false },
  openai: { endpoint:'https://api.openai.com/v1/chat/completions', defaultModel:'gpt-4.1-mini', vision:true, needsKey:true },
  deepseek: { endpoint:'https://api.deepseek.com/chat/completions', defaultModel:'deepseek-chat', vision:false, needsKey:true }
});

export function validateChat(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请求格式无效');
  const provider = PROVIDERS[input.provider];
  if (!provider) throw new Error('不支持的 AI 服务商');
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/.test(model)) throw new Error('模型名称无效');
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (provider.needsKey && (key.length < 8 || key.length > 512 || /\s/.test(key))) throw new Error('请输入有效的个人 API Key');
  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 9) throw new Error('对话历史长度无效');
  const normalized = messages.map((m) => {
    if (!m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 25000) throw new Error('对话内容无效');
    return {role:m.role,content:m.content};
  });
  if (normalized.at(-1).role !== 'user') throw new Error('最后一条必须是用户问题');
  const image = input.image;
  if (image != null && (typeof image !== 'string' || !provider.vision || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image) || image.length > 9_000_000)) throw new Error('此模型不支持图片，或图片过大');
  if (image) normalized[normalized.length-1].content = [{type:'text',text:normalized.at(-1).content},{type:'image_url',image_url:{url:image}}];
  return {provider,model,key,messages:normalized};
}

export async function invokeModel(input,{fetchImpl=fetch,signal}={}) {
  const {provider,model,key,messages}=validateChat(input);
  const headers={'Content-Type':'application/json'};
  if (provider.needsKey) headers.Authorization=`Bearer ${key}`;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),90000);
  if (signal) signal.addEventListener('abort',()=>controller.abort(),{once:true});
  try {
    const res=await fetchImpl(provider.endpoint,{method:'POST',headers,body:JSON.stringify({model,messages,max_tokens:1200,stream:false}),signal:controller.signal});
    if (!res.ok) throw new Error(`AI 服务返回 HTTP ${res.status}；请检查模型、密钥及账户额度`);
    const data=await res.json();
    const answer=data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('AI 未返回可读文字');
    return answer.slice(0,20000);
  } catch (err) {
    if (controller.signal.aborted) throw new Error('请求超时或已取消');
    throw err;
  } finally {clearTimeout(timer);}
}

function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body));}
export function makeHandler({port=8787,fetchImpl=fetch,root=ROOT,keys={openai:process.env.OPENAI_API_KEY||'',deepseek:process.env.DEEPSEEK_API_KEY||''}}={}) {
  const host=`127.0.0.1:${port}`;
  return async (req,res)=>{
    try {
      if (req.headers.host !== host) return json(res,403,{error:'只允许本机 127.0.0.1 访问'});
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res,403,{error:'拒绝跨站请求'});
      const uri=new URL(req.url,`http://${host}`);
      if (uri.pathname === '/api/health' && req.method === 'GET') return json(res,200,{ok:true,mode:'local-only',providers:Object.keys(PROVIDERS)});
      if (uri.pathname === '/api/chat') {
        if (req.method !== 'POST') return json(res,405,{error:'仅允许 POST'});
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) return json(res,415,{error:'仅接受 JSON'});
        const parts=[];let total=0;
        for await (const part of req){total+=part.length;if(total>LIMIT)return json(res,413,{error:'请求内容过大'});parts.push(part);}
        let input;
        try {input=JSON.parse(Buffer.concat(parts).toString('utf8'));} catch {return json(res,400,{error:'JSON 格式错误'});}
        try { const answer=await invokeModel({...input,key:keys[input.provider]||''},{fetchImpl});return json(res,200,{answer}); }
        catch(err){return json(res,400,{error:String(err.message||'请求失败').slice(0,240)});}
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'方法不允许'});
      const pathname=decodeURIComponent(uri.pathname);
      if (/\0|\\/.test(pathname)) return json(res,400,{error:'路径无效'});
      const path=resolve(root,`.${pathname === '/'?'/index.html':pathname}`);
      if (path !== root && !path.startsWith(root+sep)) return json(res,403,{error:'禁止访问'});
      const relative=path.slice(root.length).split(sep).filter(Boolean);
      if (relative.some(x=>x.startsWith('.')) || relative[0]==='local-api' || relative[0]==='tests' || relative[0]==='mcp-reader') return json(res,404,{error:'找不到文件'});
      if (!(extname(path) in TYPES)) return json(res,404,{error:'找不到文件'});
      const info=await stat(path);
      if (!info.isFile()) return json(res,404,{error:'找不到文件'});
      const file=await readFile(path);
      res.writeHead(200,{'Content-Type':TYPES[extname(path)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
      res.end(req.method==='HEAD'?undefined:file);
    } catch {if(!res.headersSent)json(res,404,{error:'找不到文件'});else res.end();}
  };
}
export function startServer({port=8787,host='127.0.0.1',fetchImpl=fetch,root=ROOT,keys}={}){
  if (host !== '127.0.0.1') throw new Error('出于安全原因，仅允许本机绑定');
  const server=http.createServer(makeHandler({port,fetchImpl,root,keys}));
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve(server));});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(()=>console.log('Roseglass 本机共读室: http://127.0.0.1:8787')).catch(err=>{console.error(err.message);process.exitCode=1;});
}
