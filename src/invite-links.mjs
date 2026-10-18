/** Public Roseglass invitation URLs. No account, document upload, API key or backend state. */
export const INVITE_PREFIX='#rg-invite=';

/** A fresh 128-bit browser-crypto identifier, not an access-control token. */
export function createInviteUrl(currentUrl,cryptoProvider=globalThis.crypto){
  if(!cryptoProvider?.getRandomValues)throw new Error('浏览器不支持安全随机数');
  const url=new URL(currentUrl);
  if(!['https:','http:'].includes(url.protocol))throw new Error('需要通过网页访问 Roseglass');
  const bytes=new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  const id=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  // Never carry an existing query string, file path secret or a previous hash into an invite.
  url.search='';
  url.hash=INVITE_PREFIX+id;
  return url.href;
}
export function parseInviteId(hash){
  const match=/^#rg-invite=([0-9a-f]{32})$/.exec(hash||'');
  return match?match[1]:null;
}
export function isShareablePage(currentUrl){
  let url;
  try{url=new URL(currentUrl);}catch{return false;}
  const name=url.hostname.toLowerCase();
  return url.protocol==='https:'&&name!=='localhost'&&name!=='127.0.0.1'&&name!=='[::1]'&&
    !name.endsWith('.local')&&!name.endsWith('.test');
}

/** All event-driven: no network activity or generated links until the user clicks. */
export function initInviteLinks({documentRef=document,locationRef=window.location,cryptoProvider=globalThis.crypto,clipboard=globalThis.navigator?.clipboard}={}){
  const $=id=>documentRef.getElementById(id);
  const open=$('invite-create'),panel=$('invite-panel'),close=$('invite-close'),
    generate=$('invite-regenerate'),copy=$('invite-copy'),
    value=$('invite-url'),status=$('invite-status'),intro=$('invite-intro');
  const invited=parseInviteId(locationRef.hash);
  if(invited){
    intro.textContent='你通过一条 Roseglass 分享链接进入。请自行上传课件、连接自己的 AI API；文件、聊天记录和密钥不会从邀请人处传来。';
    intro.classList.remove('hidden');
  }
  const make=()=>{
    if(!isShareablePage(locationRef.href)){
      value.value='';copy.disabled=true;
      status.textContent='当前仍是本机或非公开网址，别人无法打开；先为固定入口配置可访问的 HTTPS 托管地址。';
      return;
    }
    try{
      value.value=createInviteUrl(locationRef.href,cryptoProvider);
      copy.disabled=false;
      status.textContent='新链接已生成。链接只用于打开阅读器，不代表权限隔离、实时协作或共享课件。';
    }catch(e){
      value.value='';copy.disabled=true;
      status.textContent=String(e?.message||'生成失败');
    }
  };
  open.addEventListener('click',()=>{
    panel.classList.remove('hidden');panel.setAttribute('aria-hidden','false');
    make();
  });
  generate.addEventListener('click',make);
  copy.addEventListener('click',async()=>{
    if(!value.value)return;
    try{
      if(!clipboard?.writeText)throw Error('Clipboard unavailable');
      await clipboard.writeText(value.value);
      status.textContent='已复制分享链接。记得让对方使用自己的 AI Key。';
    }catch{
      value.focus();value.select();
      status.textContent='浏览器不允许自动复制，链接已选中，请手动复制。';
    }
  });
  close.addEventListener('click',()=>{
    panel.classList.add('hidden');panel.setAttribute('aria-hidden','true');open.focus();
  });
  panel.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();close.click();}
  });
}
