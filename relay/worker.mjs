/** Optional PUBLIC Roseglass relay. No private g-mind, ChatGPT cookie, or shared API key. */
const TTL_MS = 30 * 60 * 1000;
const MAX_TEXT = 8500;
const MAX_IMAGE = 480000;
const noStore = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response = (data,status=200,extra={}) => new Response(JSON.stringify(data),{status,headers:{...noStore,...extra}});
const randomHex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const tokenMatch=(left,right)=>{
  if(typeof left!=='string'||typeof right!=='string'||left.length!==right.length)return false;
  let difference=0;for(let i=0;i<left.length;i++)difference|=left.charCodeAt(i)^right.charCodeAt(i);return difference===0;
};
const token = request => {
  const m=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization')||'');
  return m?.[1]||null;
};
function validPoint(point) {
  return point === null || (point && typeof point==='object' &&
    Number.isFinite(point.x)&&point.x>=0&&point.x<=1 &&
    Number.isFinite(point.y)&&point.y>=0&&point.y<=1);
}
function validateSelection(p){
  if(!p||typeof p!=='object'||Array.isArray(p))return 'Expected a selection object';
  if(!Number.isInteger(p.page)||p.page<1||p.page>100000)return 'Invalid page';
  if(!Number.isInteger(p.pageCount)||p.pageCount<p.page||p.pageCount>100000)return 'Invalid pageCount';
  if(!validPoint(p.point ?? null))return 'Invalid point';
  if(!Number.isSafeInteger(p.clientSequence)||p.clientSequence<1)return 'Invalid client sequence';
  if(typeof p.text!=='string'||p.text.length>MAX_TEXT)return 'Text too long or invalid';
  if(p.imageBase64!==undefined &&
    (typeof p.imageBase64!=='string'||p.imageBase64.length>MAX_IMAGE||
     !/^[A-Za-z0-9+/]*={0,2}$/.test(p.imageBase64)))return 'Invalid PNG data';
  if(p.imageBase64!==undefined && p.mimeType!=='image/png')return 'Only PNG supported';
  if(typeof p.note!=='string'||p.note.length>500)return 'Invalid note';
  return null;
}
async function jsonWithLimit(request,maxBytes) {
  const length=Number(request.headers.get('content-length')||'0');
  if(length>maxBytes)throw new Error('BODY_TOO_LARGE');
  const raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>maxBytes)throw new Error('BODY_TOO_LARGE');
  return JSON.parse(raw);
}
const allowedOrigin=(request,env)=>{
  const origin=request.headers.get('origin')||'';
  const allowed=String(env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim());
  return origin && allowed.includes(origin) ? origin : null;
};
const cors = origin => ({
  'access-control-allow-origin':origin,
  'access-control-allow-headers':'authorization, content-type',
  'access-control-allow-methods':'POST, PUT, GET, DELETE, OPTIONS',
  'vary':'Origin'
});
const sessionUrl=(roomId,endpoint)=>`https://roseglass.internal/${endpoint}/${roomId}`;
const stubFor=(env,id)=>env.ROOMS.get(env.ROOMS.idFromName(id));
const internalRequest=(url,method='GET',body,secret)=>new Request(url,{
  method,headers:{...(body?{'content-type':'application/json'}:{}),...(secret?{authorization:`Bearer ${secret}`}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
});
export class ReadingRoom {
  constructor(state){this.state=state;}
  async alarm(){await this.state.storage.deleteAll();}
  async fetch(request){
    const u=new URL(request.url),action=u.pathname.split('/')[1];
    if(action==='init'){
      if(request.method!=='POST')return response({error:'METHOD_NOT_ALLOWED'},405);
      const old=await this.state.storage.get('record');
      if(old)return response({error:'ALREADY_CREATED'},409);
      const payload=await request.json();
      if(!/^[a-f0-9]{64}$/.test(payload?.readHash||'')||!/^[a-f0-9]{64}$/.test(payload?.writeHash||''))
        return response({error:'INVALID_AUTH_SETUP'},400);
      const expiresAt=Date.now()+TTL_MS;
      await this.state.storage.put('record',{readHash:payload.readHash,writeHash:payload.writeHash,expiresAt,selection:null,version:0});
      await this.state.storage.setAlarm(expiresAt);
      return response({ok:true,expiresAt});
    }
    const room=await this.state.storage.get('record');
    if(!room || room.expiresAt<=Date.now())return response({error:'ROOM_EXPIRED'},410);
    const provided=token(request);
    if(!provided)return response({error:'AUTH_REQUIRED'},401);
    const providedHash=await sha256(provided);
    if(action==='read'){
      if(!tokenMatch(providedHash,room.readHash))return response({error:'AUTH_DENIED'},403);
      return response({ok:true,version:room.version,selection:room.selection,expiresAt:room.expiresAt});
    }
    if(!tokenMatch(providedHash,room.writeHash))return response({error:'AUTH_DENIED'},403);
    if(action==='close'){
      if(request.method!=='DELETE')return response({error:'METHOD_NOT_ALLOWED'},405);
      await this.state.storage.deleteAll();
      return response({ok:true});
    }
    if(action==='write'){
      if(request.method!=='PUT')return response({error:'METHOD_NOT_ALLOWED'},405);
      let selection;try{selection=await jsonWithLimit(request,650000);}catch{return response({error:'INVALID_JSON_OR_SIZE'},413);}
      const error=validateSelection(selection);if(error)return response({error},400);
      if(room.selection && selection.clientSequence<=room.selection.clientSequence)
        return response({ok:true,stale:true,version:room.version});
      room.version++;
      room.selection={
        page:selection.page,pageCount:selection.pageCount,clientSequence:selection.clientSequence,point:selection.point??null,
        text:selection.text,note:selection.note,imageBase64:selection.imageBase64??null,
        mimeType:selection.imageBase64?'image/png':null,updatedAt:Date.now()
      };
      await this.state.storage.put('record',room);
      return response({ok:true,version:room.version});
    }
    return response({error:'NOT_FOUND'},404);
  }
}
async function handleMcp(request,env){
  let p;try{p=await jsonWithLimit(request,8192);}catch{return response({error:'INVALID_MCP_REQUEST'},400);}
  if(p?.jsonrpc!=='2.0')return response({error:'INVALID_MCP_REQUEST'},400);
  if(p.method==='notifications/initialized')return new Response(null,{status:202,headers:{'cache-control':'no-store'}});
  const ok=(result)=>response({jsonrpc:'2.0',id:p.id??null,result});
  const err=(message,code=-32602)=>response({jsonrpc:'2.0',id:p.id??null,error:{code,message}});
  if(p.method==='initialize')return ok({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'roseglass-public-reader',version:'0.1.0'}});
  if(p.method==='ping')return ok({});
  if(p.method==='tools/list')return ok({tools:[{
    name:'get_selected_slide',
    description:'Read the most recently CLICKED page/point from the caller\'s separately paired, opt-in Roseglass reading session. Only use a room ID and read key provided by this user. The session expires in 30 minutes. Returns actual page text, click coordinates, optional PNG and version; if image is absent, do not guess its contents.',
    inputSchema:{type:'object',additionalProperties:false,required:['room_id','read_key'],properties:{
      room_id:{type:'string',description:'32 lowercase hex characters from the reader'},
      read_key:{type:'string',description:'64 lowercase hex characters, shown only to this room participant'}
    }}
  }]});
  if(p.method!=='tools/call')return err('METHOD_NOT_FOUND',-32601);
  if(p.params?.name!=='get_selected_slide')return err('UNKNOWN_TOOL');
  const a=p.params?.arguments||{};
  if(!/^[a-f0-9]{32}$/.test(a.room_id||'')||!/^[a-f0-9]{64}$/.test(a.read_key||''))return err('INVALID_PAIRING');
  const inner=await stubFor(env,a.room_id).fetch(internalRequest(sessionUrl(a.room_id,'read'),'GET',null,a.read_key));
  const data=await inner.json();
  if(!inner.ok)return ok({isError:true,content:[{type:'text',text:data.error||'Room unavailable'}]});
  if(!data.selection)return ok({content:[{type:'text',text:'Room paired, but no page has been clicked or synced yet.'}]});
  const s=data.selection;
  const info=`Roseglass CURRENT selection, version ${data.version}, page ${s.page}/${s.pageCount}.\nClick point: ${s.point?JSON.stringify(s.point):'none'}.\nUser note: ${s.note||'none'}.\nText extracted from this page:\n${s.text||'(no readable text; refer to actual image if present)'}`;
  const content=[{type:'text',text:info}];
  if(s.imageBase64)content.push({type:'image',data:s.imageBase64,mimeType:'image/png'});
  else content.push({type:'text',text:'No page image received. Do not infer colors, shapes, charts, or illustrations from coordinates.'});
  return ok({content});
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    if(path==='/health'&&request.method==='GET')return response({ok:true,service:'roseglass-public-relay'});
    if(path==='/mcp'&&request.method==='POST'){
      if(!env.ROOMS)return response({error:'ROOM_STORAGE_NOT_CONFIGURED'},503);
      return handleMcp(request,env);
    }
    if(path==='/mcp')return response({error:'METHOD_NOT_ALLOWED'},405);
    const origin=allowedOrigin(request,env);
    if(!origin)return response({error:'ORIGIN_NOT_ALLOWED'},403);
    const headers=cors(origin);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!env.ROOMS)return response({error:'ROOM_STORAGE_NOT_CONFIGURED'},503,headers);
    if(path==='/v1/rooms'&&request.method==='POST'){
      const roomId=randomHex(16),readKey=randomHex(32),writeKey=randomHex(32);
      const inner=await stubFor(env,roomId).fetch(internalRequest(sessionUrl(roomId,'init'),'POST',{
        readHash:await sha256(readKey),writeHash:await sha256(writeKey)
      }));
      if(!inner.ok)return response({error:'INIT_FAILED'},503,headers);
      const {expiresAt}=await inner.json();
      return response({roomId,readKey,writeKey,expiresAt},201,headers);
    }
    const match=/^\/v1\/rooms\/([a-f0-9]{32})\/(selection|close)$/.exec(path);
    if(!match)return response({error:'NOT_FOUND'},404,headers);
    const [,roomId,action]=match;
    const secret=token(request);
    if(!secret)return response({error:'AUTH_REQUIRED'},401,headers);
    if(action==='selection'&&request.method==='PUT'){
      let p;try{p=await jsonWithLimit(request,650000);}catch{return response({error:'INVALID_JSON_OR_SIZE'},413,headers);}
      const error=validateSelection(p);if(error)return response({error},400,headers);
      const inner=await stubFor(env,roomId).fetch(internalRequest(sessionUrl(roomId,'write'),'PUT',p,secret));
      return response(await inner.json(),inner.status,headers);
    }
    if(action==='close'&&request.method==='DELETE'){
      const inner=await stubFor(env,roomId).fetch(internalRequest(sessionUrl(roomId,'close'),'DELETE',null,secret));
      return response(await inner.json(),inner.status,headers);
    }
    return response({error:'METHOD_NOT_ALLOWED'},405,headers);
  }
};
