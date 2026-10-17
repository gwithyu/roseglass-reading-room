import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{ReadingRoom} from '../relay/worker.mjs';

class MemoryStorage {
  values=new Map();
  async get(k){return this.values.get(k);}
  async put(k,v){this.values.set(k,structuredClone(v));}
  async setAlarm(t){this.alarm=t;}
  async deleteAll(){this.values.clear();}
}
class FakeNamespace{
  objects=new Map();
  idFromName(s){return s;}
  get(id){
    if(!this.objects.has(id))this.objects.set(id,{object:new ReadingRoom({storage:new MemoryStorage()})});
    const v=this.objects.get(id);
    return {fetch:request=>v.object.fetch(request)};
  }
  storage(id){return this.objects.get(id)?.object.state.storage;}
}
function setup(){
  const rooms=new FakeNamespace();
  return {rooms,env:{ROOMS:rooms,ALLOWED_ORIGINS:'https://reader.example'}};
}
const ORIGIN={'origin':'https://reader.example'};
async function send(env,path,method='GET',{data,auth,origin=true}={}){
  const headers={...(origin?ORIGIN:{}),...(auth?{authorization:`Bearer ${auth}`}:{}),
    ...(data?{'content-type':'application/json'}:{})};
  const req=new Request('https://relay.example'+path,{method,headers,...(data?{body:JSON.stringify(data)}:{})});
  const res=await worker.fetch(req,env);
  return {status:res.status,json:await res.json()};
}
async function make(env){
  const r=await send(env,'/v1/rooms','POST');
  assert.equal(r.status,201);
  assert.match(r.json.roomId,/^[0-9a-f]{32}$/);
  assert.match(r.json.readKey,/^[0-9a-f]{64}$/);
  assert.match(r.json.writeKey,/^[0-9a-f]{64}$/);
  assert.notEqual(r.json.readKey,r.json.writeKey);
  return r.json;
}
function data(seq=1,more={}){return {page:3,pageCount:10,point:{x:.25,y:.75},text:'Supply curve',note:'explain this',clientSequence:seq,...more};}
async function write(env,room,selection){return send(env,`/v1/rooms/${room.roomId}/selection`,'PUT',{data:selection,auth:room.writeKey});}
async function readMcp(env,roomId,readKey){
  return send(env,'/mcp','POST',{data:{jsonrpc:'2.0',id:1,method:'tools/call',
    params:{name:'get_selected_slide',arguments:{room_id:roomId,read_key:readKey}}}});
}
test('read capability sees clicked content, but not write credential',async()=>{
  const {env}=setup(),room=await make(env);
  assert.equal((await write(env,room,data())).status,200);
  const result=await readMcp(env,room.roomId,room.readKey);
  assert.equal(result.status,200);
  const joined=JSON.stringify(result.json);
  assert.match(joined,/Supply curve/);assert.match(joined,/0.25/);
  assert.doesNotMatch(joined,new RegExp(room.writeKey));assert.doesNotMatch(joined,new RegExp(room.readKey));
});
test('image is actual content item, not a claim of visual readback',async()=>{
  const {env}=setup(),room=await make(env);
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  assert.equal((await write(env,room,data(1,{imageBase64:image,mimeType:'image/png'}))).status,200);
  const result=await readMcp(env,room.roomId,room.readKey);
  const content=result.json.result.content;
  assert.deepEqual(content.filter(i=>i.type==='image').map(i=>i.mimeType),['image/png']);
  assert.equal(content.find(i=>i.type==='image').data,image);
});
test('older concurrent click cannot replace newer selection',async()=>{
  const {env}=setup(),room=await make(env);
  await write(env,room,data(3,{text:'newer'}));
  const stale=await write(env,room,data(2,{text:'older'}));
  assert.equal(stale.json.stale,true);
  assert.match(JSON.stringify((await readMcp(env,room.roomId,room.readKey)).json),/newer/);
});
test('wrong write key and wrong read key cannot cross rooms',async()=>{
  const {env}=setup(),one=await make(env),two=await make(env);
  assert.equal((await send(env,`/v1/rooms/${one.roomId}/selection`,'PUT',{data:data(),auth:two.writeKey})).status,403);
  await write(env,one,data());
  const wrong=await readMcp(env,one.roomId,two.readKey);
  assert.equal(wrong.json.result.isError,true);
  const empty=await readMcp(env,two.roomId,two.readKey);
  assert.match(JSON.stringify(empty.json),/no page has been clicked/);
});
test('close revokes immediately, incorrect close does not revoke',async()=>{
  const {env}=setup(),room=await make(env);
  const path=`/v1/rooms/${room.roomId}/close`;
  assert.equal((await send(env,path,'DELETE',{auth:'a'.repeat(64)})).status,403);
  assert.equal((await send(env,path,'DELETE',{auth:room.writeKey})).status,200);
  assert.match(JSON.stringify((await readMcp(env,room.roomId,room.readKey)).json),/ROOM_EXPIRED/);
});
test('expired room, invalid data and non-allowlisted origin are denied',async()=>{
  const {env,rooms}=setup(),room=await make(env);
  assert.equal((await write(env,room,data(1,{page:11}))).status,400);
  assert.equal((await write(env,room,data(1,{imageBase64:'a'.repeat(480001),mimeType:'image/png'}))).status,400);
  assert.equal((await send(env,'/v1/rooms','POST',{origin:false})).status,403);
  const rec=await rooms.storage(room.roomId).get('record');
  rec.expiresAt=Date.now()-1;await rooms.storage(room.roomId).put('record',rec);
  assert.equal((await write(env,room,data(2))).status,410);
});
test('MCP lists only the one explicitly read-only operation',async()=>{
  const {env}=setup();
  const r=await send(env,'/mcp','POST',{data:{jsonrpc:'2.0',id:2,method:'tools/list'}});
  assert.deepEqual(r.json.result.tools.map(x=>x.name),['get_selected_slide']);
});
