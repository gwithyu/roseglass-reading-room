/** Public standalone reader only. Ephemeral BYOK UI, no credentials stored or shared. */
const PRESETS={
  ollama:{model:'llava',vision:true},
  openai:{model:'gpt-4.1-mini',vision:true},
  deepseek:{model:'deepseek-chat',vision:false}
};
const $=id=>document.getElementById(id);
export function initAiChat({getContext,notice=()=>{}}){
  const panel=$('ai-panel'),open=$('open-ai'),close=$('close-ai'),provider=$('ai-provider'),model=$('ai-model'),question=$('ai-question'),send=$('ai-send'),history=$('ai-messages'),status=$('ai-status'),image=$('ai-image');
  let conversation=[],currentDocument=null,working=false;
  const append=(role,content)=>{
    const p=document.createElement('p');p.className=`ai-bubble ${role}`;p.textContent=content;history.append(p);history.scrollTop=history.scrollHeight;
  };
  const updateProvider=()=>{
    const preset=PRESETS[provider.value];model.value=preset.model;
    image.disabled=!preset.vision;
    if(!preset.vision)image.checked=false;
    status.textContent=provider.value==='ollama'?'本机 Ollama 需提前安装并下载相应模型；不会产生云端 API 费用。':'云端 API Key 只从本机服务的环境变量读取；服务商可能对你收费。';
    conversation=[];currentDocument=null;history.replaceChildren();
  };
  const availability=async()=>{
    try{const response=await fetch('/api/health',{cache:'no-store'});const data=await response.json();
      if(!response.ok||data?.mode!=='local-only')throw new Error();
      return true;
    }catch{return false;}
  };
  open.addEventListener('click',async()=>{
    panel.classList.remove('hidden');panel.setAttribute('aria-hidden','false');
    status.textContent='正在检查本机 API 服务…';
    const ready=await availability();
    status.textContent=ready?'本机接口已连接。只有点击“发送问题”才会提交本页内容。':'未连接本机 API 服务。请在仓库目录运行 node local-api/server.mjs，然后打开 http://127.0.0.1:8787';
    question.focus();
  });
  close.addEventListener('click',()=>{panel.classList.add('hidden');panel.setAttribute('aria-hidden','true');open.focus();});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape')close.click();if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();send.click();}});
  provider.addEventListener('change',updateProvider);
  $('ai-reset').addEventListener('click',()=>{conversation=[];currentDocument=null;history.replaceChildren();status.textContent='本标签页的临时对话已清空。';});
  send.addEventListener('click',async()=>{
    if(working)return;
    const prompt=question.value.trim();if(!prompt)return notice('先写下你想问的内容');
    working=true;send.disabled=true;status.textContent='正在整理当前页…';
    try{
      const page=await getContext({includeImage:image.checked});
      if(currentDocument!==page.documentKey){currentDocument=page.documentKey;conversation=[];history.replaceChildren();}
      const text=`你是共读助手。只能依据提供的真实文字及你实际收到的图像分析，遇到无法确认的内容要说明.\n${page.text.slice(0,16000)}\n\n用户的问题：${prompt}`;
      const next=[...conversation.slice(-6),{role:'user',content:text}];
      status.textContent='已准备好内容；正在请求你选择的 AI 服务（可能消耗你自己的 API 额度）…';
      const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:provider.value,model:model.value.trim(),messages:next,image:page.image||null})});
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||`HTTP ${response.status}`);
      append('user',prompt);append('assistant',data.answer);
      conversation=[...next,{role:'assistant',content:data.answer}].slice(-8);
      question.value='';status.textContent='讲解完成。对话仅保留在本标签页内存中；服务商有自己的数据处理政策。';
    }catch(err){status.textContent=String(err.message||'发送失败');}
    finally{working=false;send.disabled=false;}
  });
  updateProvider();
}
