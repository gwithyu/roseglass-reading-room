/** Optional ChatGPT image-ref relay. Never confuse accepted upload with model vision. */
export async function relayImageToChat({host,blob,fileName,prompt,modelContent,privateContent={},canProceed=()=>true,onPhase=()=>{}}) {
  const required=['uploadFile','setWidgetState','sendFollowUpMessage'];
  if(required.some(k=>typeof host?.[k]!=='function'))return {status:'manual_required',stage:'capability'};
  let stage='start';
  try {
    if(!canProceed())return {status:'cancelled',stage};
    const file = new File([blob],fileName,{type:'image/png'});
    const upload = await host.uploadFile(file,{library:false});
    if(typeof upload?.fileId!=='string'||!upload.fileId)throw new Error('上传未返回有效图像引用');
    stage='uploaded';onPhase(stage);
    if(!canProceed())return {status:'cancelled',stage};
    await host.setWidgetState({
      modelContent: modelContent || '已请求分享一张页面图片，请核实是否真的能看见图像像素。',
      privateContent, imageIds:[upload.fileId]
    });
    stage='linked';onPhase(stage);
    if(!canProceed())return {status:'cancelled',stage};
    await host.sendFollowUpMessage({prompt});
    stage='followup_requested';onPhase(stage);
    return {status:'followup_requested',stage};
  } catch(error) {
    return {status:'manual_required',stage,reason:error instanceof Error?error.message:'未知上传错误'};
  }
}