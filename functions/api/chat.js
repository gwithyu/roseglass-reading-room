/** Roseglass public Pages Function: BYOK-only, fixed destinations, zero shared tokens.
 * API keys pass transiently through this proxy to the user's chosen provider.
 * NEVER enable request-body logging or analytics for this endpoint.
 */
export const CLOUD_MODE='pages-byok';
export const CLOUD_PROVIDERS=Object.freeze({
  openai:{url:'https://api.openai.com/v1/chat/completions',vision:true},
  deepseek:{url:'https://api.deepseek.com/chat/completions',vision:false},
  qwen:{url:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',vision:true},
  kimi:{url:'https://api.moonshot.ai/v1/chat/completions',vision:false}
});
// Keep below Netlify's 6 MB buffered request limit (which includes JSON and image base64).
export const MAX_BYTES=4_800_000;
// Netlify synchronous functions have a 60-second hard limit; leave cold-start/response headroom.
export const UPSTREAM_TIMEOUT_MS=45_000;
const RESPONSE_HEADERS={
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, max-age=0',
  'Pragma':'no-cache',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff'
};
function answer(status,body){return new Response(JSON.stringify(body),{status,headers:RESPONSE_HEADERS});}
export function validateRequest(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('请求格式无效');
  const provider=Object.hasOwn(CLOUD_PROVIDERS,payload.provider)?CLOUD_PROVIDERS[payload.provider]:null;
  if(!provider)throw Error('暂不支持此服务商');
  const key=typeof payload.key==='string'?payload.key.trim():'';
  if(key.length<8||key.length>512||/\s/.test(key))throw Error('需要有效的个人 API Key');
  const model=typeof payload.model==='string'?payload.model.trim():'';
  if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/.test(model))throw Error('模型名称无效');
  const messages=payload.messages;
  if(!Array.isArray(messages)||messages.length<1||messages.length>9)throw Error('对话轮次超过限制');
  const cleaned=messages.map(item=>{
    if(!item||!['user','assistant'].includes(item.role)||typeof item.content!=='string'||!item.content.trim()||item.content.length>25000)throw Error('对话内容无效');
    return {role:item.role,content:item.content};
  });
  if(cleaned.at(-1).role!=='user')throw Error('最后一条必须是提问');
  const image=payload.image;
  if(image!=null&&(typeof image!=='string'||!provider.vision||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>4_300_000))throw Error('图片过大或当前模型不支持图片；请关闭图片选项，仅发送文字后重试');
  if(image)cleaned[cleaned.length-1].content=[
    {type:'text',text:cleaned.at(-1).content},
    {type:'image_url',image_url:{url:image}}
  ];
  return {provider,model,key,messages:cleaned};
}
export async function handleChat(request,{fetchImpl=fetch}={}){
  if(request.method!=='POST')return answer(405,{error:'仅允许 POST'});
  const origin=request.headers.get('Origin');
  if(!origin||origin!==new URL(request.url).origin)return answer(403,{error:'请求来源不受信任'});
  const fetchSite=request.headers.get('Sec-Fetch-Site');
  if(fetchSite&&fetchSite!=='same-origin'&&fetchSite!=='none')return answer(403,{error:'禁止跨站访问'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))return answer(415,{error:'仅接受 JSON'});
  const declared=Number(request.headers.get('Content-Length')||0);
  if(declared>MAX_BYTES)return answer(413,{error:'请求过大'});
  let raw;
  try{raw=await request.arrayBuffer();}catch{return answer(400,{error:'请求读取失败'});}
  if(raw.byteLength>MAX_BYTES)return answer(413,{error:'请求过大'});
  let input;
  try{input=validateRequest(JSON.parse(new TextDecoder().decode(raw)));}catch(error){return answer(400,{error:String(error.message||'请求无效').slice(0,140)});}
  let upstream;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),UPSTREAM_TIMEOUT_MS);
    try{
      upstream=await fetchImpl(input.provider.url,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${input.key}`},
        body:JSON.stringify({model:input.model,messages:input.messages,max_tokens:1200,stream:false}),
        redirect:'error',signal:controller.signal
      });
    }finally{clearTimeout(timeout);}
  }catch{return answer(502,{error:'连接 AI 服务商失败；请确认该服务在当前地区可用'});}
  if(!upstream.ok)return answer(502,{error:`AI 服务商返回 HTTP ${upstream.status}。请核对 Key、模型及账户额度`});
  try{
    const json=await upstream.json();
    const content=json?.choices?.[0]?.message?.content;
    if(typeof content!=='string'||!content.trim())throw Error('empty');
    return answer(200,{answer:content.slice(0,20_000)});
  }catch{return answer(502,{error:'服务商响应格式不兼容'});}
}
export async function onRequestPost({request}){return handleChat(request);}
export function onRequestGet(){return answer(405,{error:'仅允许 POST'});}
