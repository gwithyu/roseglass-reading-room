import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSync,normalizeRelayEndpoint} from '../src/live-sync.mjs';

function makeFetch({stopFails=false,expiresAt=Date.now()+1800000}={}){
  const requests=[];
  const room={roomId:'a'.repeat(32),readKey:'b'.repeat(64),writeKey:'c'.repeat(64),expiresAt};
  const fake=async(url,options)=>{
    requests.push({url,options});
    const status=options.method==='DELETE'&&stopFails?500:options.method==='POST'?201:200;
    return {ok:status<300,status,async json(){return status===500?{error:'REVOKE_FAILED'}:
      options.method==='POST'?room:options.method==='PUT'?{ok:true,version:requests.length}: {ok:true};}};
  };
  return {fake,requests,room};
}
test('refuses unsafe HTTP, credentialed endpoints, and remote URL query strings',()=>{
  assert.throws(()=>normalizeRelayEndpoint('http://remote.example'),/HTTPS/);
  assert.throws(()=>normalizeRelayEndpoint('https://user:pass@relay.example'),/账号/);
  assert.throws(()=>normalizeRelayEndpoint('https://relay.example/?secret=1'),/查询参数/);
  assert.equal(normalizeRelayEndpoint('https://relay.example/v1'),'https://relay.example');
});
test('pairs with reader-owned read key and never puts read key in selection authorization',async()=>{
  const {fake,requests,room}=makeFetch(),client=createLiveSync(fake);
  await client.start('https://relay.example');
  assert(client.active);
  assert.match(client.pairingText(),new RegExp(room.readKey));
  await client.publish({page:1,pageCount:3,point:{x:.1,y:.5},text:'ABC',note:''});
  const write=requests.at(-1);
  assert.equal(write.options.headers.authorization,`Bearer ${room.writeKey}`);
  assert.doesNotMatch(write.options.body,new RegExp(room.readKey));
  assert.equal(JSON.parse(write.options.body).clientSequence,1);
  await client.publish({page:2,pageCount:3,point:{x:.4,y:.5},text:'DEF',note:''});
  assert.equal(JSON.parse(requests.at(-1).options.body).clientSequence,2);
});
test('refuses duplicate live sessions and revokes only after server acknowledgement',async()=>{
  const {fake,requests}=makeFetch(),client=createLiveSync(fake);
  await client.start('https://relay.example');
  await assert.rejects(client.start('https://relay.example'),/结束已有/);
  await client.stop();assert.equal(client.active,false);
  assert.equal(requests.at(-1).options.method,'DELETE');
});
test('failed revoke preserves capability and warning rather than pretending closed',async()=>{
  const {fake}=makeFetch({stopFails:true}),client=createLiveSync(fake);
  await client.start('https://relay.example');
  await assert.rejects(client.stop(),/REVOKE_FAILED/);
  assert(client.active);
});
test('expired room can be replaced without carrying prior read key',async()=>{
  let starts=0;
  const fake=async(url,opts)=>{
    if(opts.method==='POST')return {ok:true,status:201,async json(){starts++;return {
      roomId:(starts%2?'1':'2').repeat(32),readKey:(starts%2?'3':'4').repeat(64),
      writeKey:(starts%2?'5':'6').repeat(64),expiresAt:Date.now()+3
    };}};
    return {ok:true,status:200,async json(){return {ok:true};}};
  };
  const client=createLiveSync(fake);
  await client.start('https://relay.example');
  // deterministic expiry simulation, avoid waiting on a real clock
  await new Promise(resolve=>setTimeout(resolve,15));
  await client.start('https://relay.example');
  assert.equal(starts,2);
});
