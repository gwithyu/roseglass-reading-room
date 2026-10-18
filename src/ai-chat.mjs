/** Public Roseglass standalone AI panel. BYOK keys live only in this tab's password input. */
const PRESETS=Object.freeze({
  ollama:{model:'llava',vision:true,local:true},
  deepseek:{model:'deepseek-chat',vision:false},
  qwen:{model:'qwen3-vl-plus',vision:true,pagesOnly:true},
  kimi:{model:'kimi-k2-thinking',vision:false,pagesOnly:true},
  openai:{model:'gpt-4.1-mini',vision:true}
});
const $=id=>document.getElementById(id);
export function initAiChat({getContext,notice=()=>{}}){
  const panel=$('ai-panel'),open=$('open-ai'),close=$('close-ai');
  const provider=$('ai-provider'),model=$('ai-model'),question=$('ai-question');
  const send=$('ai-send'),history=$('ai-messages'),status=$('ai-status');
  const image=$('ai-image'),cloudConsent=$('ai-cloud-consent');
  const keyInput=$('ai-api-key'),keyWrap=$('ai-key-wrap');
  let conversation=[],currentDocument=null,working=false,mode=null;
  let sessionVersion=0,activeAbort=null;

  const clearHistory=()=>{
    conversation=[];currentDocument=null;history.replaceChildren();
  };
  const clearKey=()=>{keyInput.value='';};
  const append=(role,content)=>{
    const p=document.createElement('p');p.className=`ai-bubble ${role}`;
    p.textContent=content;history.append(p);history.scrollTop=history.scrollHeight;
  };
  const invalidateRequest=()=>{
    sessionVersion++;
    if(activeAbort)activeAbort.abort();
  };
  const updateProvider=()=>{
    invalidateRequest();
    const chosen=PRESETS[provider.value]||PRESETS.deepseek;
    model.value=chosen.model;image.disabled=!chosen.vision;
    if(!chosen.vision)image.checked=false;
    cloudConsent.checked=false;
    cloudConsent.disabled=provider.value==='ollama';
    const usePageKey=mode==='pages-byok'&&provider.value!=='ollama';
    keyWrap.classList[usePageKey?'remove':'add']('hidden');
    clearKey();clearHistory();
    if(mode==='pages-byok'){
      status.textContent='个人 API Key 仅保留在当前页面输入框，发送时经过 Roseglass 中转到所选服务商。不会保存在本站；服务商可能计费。';
    }else{
      status.textContent=provider.value==='ollama'
        ?'本机 Ollama 需预先安装模型；不会产生云端 API 费用。'
        :'本机模式：Key 只从你自己电脑的服务端环境变量读取，API 可能收费。';
    }
  };
  const availability=async()=>{
    try{
      const response=await fetch('/api/health',{cache:'no-store'});
      const data=await response.json();
      if(!response.ok||!['local-only','pages-byok'].includes(data?.mode))return null;
      return data.mode;
    }catch{return null;}
  };
  open.addEventListener('click',async()=>{
    panel.classList.remove('hidden');panel.setAttribute('aria-hidden','false');
    status.textContent='正在检查 API 接口…';
    const healthSession=++sessionVersion;
    const checked=await availability();
    if(healthSession!==sessionVersion)return; // panel closed or reopened during health check
    mode=checked;
    if(mode==='pages-byok'&&provider.value==='ollama')provider.value='deepseek';
    if(mode==='local-only'&&PRESETS[provider.value]?.pagesOnly)provider.value='ollama';
    updateProvider();
    if(!mode)status.textContent='未找到 API 接口；若是本地安装，请启动 node local-api/server.mjs，公开版需要部署带 API Functions 的网站。';
    question.focus();
  });
  close.addEventListener('click',()=>{
    invalidateRequest();
    clearKey();panel.classList.add('hidden');panel.setAttribute('aria-hidden','true');open.focus();
  });
  panel.addEventListener('keydown',e=>{
    if(e.key==='Escape')close.click();
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();send.click();}
  });
  provider.addEventListener('change',updateProvider);
  // A different model or personal Key must not inherit in-flight requests or old chat context.
  model.addEventListener('input',()=>{invalidateRequest();clearHistory();});
  keyInput.addEventListener('input',()=>{invalidateRequest();clearHistory();});
  $('ai-reset').addEventListener('click',()=>{
    invalidateRequest();
    clearHistory();clearKey();status.textContent='临时对话和 API Key 输入已清空。';
  });
  send.addEventListener('click',async()=>{
    if(working)return;
    const prompt=question.value.trim();
    if(!prompt)return notice('先写下你想问的内容');
    if(!mode){status.textContent='API 接口尚未连接。';return;}
    if(mode==='pages-byok'&&provider.value==='ollama'){status.textContent='公共网页不能访问你的本机 Ollama；请选择云端 API。';return;}
    if(mode==='local-only'&&PRESETS[provider.value]?.pagesOnly){status.textContent='此服务商需要带 API 接口的公开托管版。';return;}
    if(provider.value!=='ollama'&&!cloudConsent.checked){
      status.textContent='请先勾选确认：使用自己的 AI API 可能产生费用。';return;
    }
    const selectedProvider=provider.value,selectedModel=model.value.trim(),selectedMode=mode;
    const selectedImage=image.checked;
    const selectedSession=sessionVersion;
    const key=selectedMode==='pages-byok'?keyInput.value.trim():undefined;
    if(mode==='pages-byok'&&(!key||key.length<8)){
      status.textContent='请输入你自己的有效 API Key；本页面不会保存密钥。';return;
    }
    working=true;send.disabled=true;status.textContent='正在整理当前页…';
    let timeout=null;
    try{
      const page=await getContext({includeImage:selectedImage});
      if(selectedSession!==sessionVersion||selectedProvider!==provider.value||selectedModel!==model.value.trim()||selectedMode!==mode||
        (selectedMode==='pages-byok'&&keyInput.value.trim()!==key))throw new Error('选项已变化，取消旧请求；没有发送 API Key。');
      if(selectedMode==='pages-byok'&&page.image&&page.image.length>4_300_000)throw new Error('当前页图像超过公开网站的大小限制。请取消「发送图片」后先用文字提问。');
      if(currentDocument!==page.documentKey){clearHistory();currentDocument=page.documentKey;}
      const text=`你是共读助手。只能依据实际收到的课件文字和页面图像分析；看不到就明确说明。\n${page.text.slice(0,16000)}\n\n问题：${prompt}`;
      const messages=[...conversation.slice(-6),{role:'user',content:text}];
      status.textContent='正在调用你自己的 AI API；请留意个人账户额度…';
      const request={provider:selectedProvider,model:selectedModel,messages,image:page.image||null};
      if(selectedMode==='pages-byok')request.key=key;
      const controller=new AbortController();
      activeAbort=controller;
      timeout=setTimeout(()=>controller.abort(),55_000);
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,body:JSON.stringify(request)});
      const data=await response.json();
      if(selectedSession!==sessionVersion) return; // stale response belongs to a cancelled session
      if(!response.ok)throw new Error(data?.error||`HTTP ${response.status}`);
      append('user',prompt);append('assistant',data.answer);
      conversation=[...messages,{role:'assistant',content:data.answer}].slice(-8);
      question.value='';
      status.textContent='讲解完成。当前标签页暂存对话；API 服务商可能另行记录与处理所发送的内容。';
    }catch(err){
      if(selectedSession===sessionVersion)status.textContent=err?.name==='AbortError'
        ?'请求已取消或超过等待时间。若请求已到达服务商，可能产生个人 API 用量。'
        :String(err.message||'发送失败');
    }
    finally{
      if(timeout!==null)clearTimeout(timeout);
      activeAbort=null;working=false;send.disabled=false;
    }
  });
  updateProvider();
}
