/** Opt-in, in-memory Roseglass bridge. No credentials persisted or shared across users. */
export function normalizeRelayEndpoint(input){
  let url;
  try{url=new URL(input);}catch{throw new Error('请输入有效的 HTTPS 共读服务地址');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:' && !(local&&url.protocol==='http:'))throw new Error('同步必须使用 HTTPS');
  if(url.username||url.password||url.search||url.hash)throw new Error('服务地址不可包含账号、密码或查询参数');
  return url.origin;
}
function validRoom(room){
  return room && /^[a-f0-9]{32}$/.test(room.roomId||'') &&
    /^[a-f0-9]{64}$/.test(room.readKey||'') &&
    /^[a-f0-9]{64}$/.test(room.writeKey||'') &&
    Number.isFinite(room.expiresAt) && room.expiresAt>Date.now();
}
async function api(fetcher,url,options){
  const response=await fetcher(url,{credentials:'omit',cache:'no-store',mode:'cors',...options});
  let body={};try{body=await response.json();}catch{}
  if(!response.ok)throw new Error(body.error||`共读服务返回 HTTP ${response.status}`);
  return body;
}
export function createLiveSync(fetcher=fetch){
  let session=null,endpoint=null,lastSequence=0;
  return {
    get active(){return !!session && session.expiresAt>Date.now();},
    get expiresAt(){return session?.expiresAt??null;},
    get roomId(){return session?.roomId??null;},
    async start(rawEndpoint){
      if(session && session.expiresAt<=Date.now()){session=null;endpoint=null;lastSequence=0;}
      if(session)throw new Error('请先关闭已有共读会话');
      const origin=normalizeRelayEndpoint(rawEndpoint);
      const room=await api(fetcher,origin+'/v1/rooms',{method:'POST'});
      if(!validRoom(room))throw new Error('共读服务返回了无效的会话凭据');
      endpoint=origin;session=room;lastSequence=0;
      return {roomId:room.roomId,readKey:room.readKey,expiresAt:room.expiresAt};
    },
    pairingText(){
      if(!session)return '';
      return `Roseglass 共读配对（只允许我的 GPT 读取；请勿公开）\nroom_id: ${session.roomId}\nread_key: ${session.readKey}\n\n请在我问“讲解当前标记”时使用 get_selected_slide 工具读取这个会话的最新课件位置。请根据实际返回的页图/文字解释，没收到图像就不要猜图形。这个会话将在 30 分钟内过期。`;
    },
    async publish(selection){
      if(!session||session.expiresAt<=Date.now())throw new Error('共读会话已结束或过期');
      const mySession=session;
      const seq=++lastSequence;
      const record={...selection,clientSequence:seq};
      return api(fetcher,`${endpoint}/v1/rooms/${mySession.roomId}/selection`,{
        method:'PUT',headers:{authorization:`Bearer ${mySession.writeKey}`,'content-type':'application/json'},
        body:JSON.stringify(record)
      });
    },
    async stop(){
      if(!session)return;
      const active=session,origin=endpoint;
      // Clear locally only after server acknowledged removal. On failure, warn: reader token remains valid until expiry.
      await api(fetcher,`${origin}/v1/rooms/${active.roomId}/close`,{
        method:'DELETE',headers:{authorization:`Bearer ${active.writeKey}`}
      });
      if(session===active){session=null;endpoint=null;lastSequence=0;}
    },
    forgetLocal(){session=null;endpoint=null;lastSequence=0;}
  };
}
