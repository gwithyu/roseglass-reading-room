/** Browser-local context packets: never transmit without a user action. */
export function buildPageContext({fileName='未命名课件',kind='pdf',pageIndex=0,pageCount=1,text='',selected=null,notes=[]}) {
  const marked = selected?.page===pageIndex && Number.isFinite(selected.x) && Number.isFinite(selected.y);
  const loc = marked ? `\n点击重点（归一化坐标）：${selected.x.toFixed(4)}, ${selected.y.toFixed(4)}` : '';
  const pageNotes = (Array.isArray(notes) ? notes : [])
    .filter(n=>n.page===pageIndex)
    .map(n=>{
      const at = Number.isFinite(n.x) && Number.isFinite(n.y) ? `位置 ${n.x.toFixed(4)}, ${n.y.toFixed(4)}` : '整页';
      return `- ${at}：${n.text||'已标记重点'}`;
    }).join('\n').slice(0,2500);
  return `请与我共读这份课件，只依据实际提供的文字或图像回答，不要推测未收到的图形。
课件：${fileName}
格式：${String(kind).toUpperCase()}
第 ${pageIndex+1} / ${pageCount} 页${loc}

===== 页面文字 =====
${text||'（当前页没有可提取文字。图像需要另行附上，不能单凭本消息识别。）'}${pageNotes?`\n\n===== 我的本页重点笔记 =====\n${pageNotes}`:''}`;
}
export function handoffMode(openai) {
  return typeof openai?.sendFollowUpMessage === 'function' ? 'embedded' : 'copy';
}
