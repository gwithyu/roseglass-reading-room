/** Ordered, lossless bounded text chunks for user-initiated chat transfers. */
export function buildTextChunks(pages,limit=9000){
  if(!Array.isArray(pages)||!Number.isInteger(limit)||limit<64)throw new Error('Invalid segmentation parameters');
  const result=[];let text='',from=0,to=0;
  const flush=()=>{if(text){result.push({from,to,text});text='';from=0;to=0;}};
  for(let i=0;i<pages.length;i++){
    const content=`\n\n===== 第 ${i+1} 页 =====\n${pages[i]||'（无可提取文字）'}`;
    let offset=0;
    if(text && text.length+content.length>limit)flush();
    while(offset<content.length){
      const remaining=limit-text.length;
      let take=Math.min(remaining,content.length-offset);
      // Do not cut between the two UTF-16 code units of an emoji.
      const last=content.charCodeAt(offset+take-1),next=content.charCodeAt(offset+take);
      if(last>=0xD800&&last<=0xDBFF&&next>=0xDC00&&next<=0xDFFF){
        if(take===1 && text.length){flush();continue;}
        if(take>1)take--;
      }
      if(!from)from=i+1;
      to=i+1;
      text+=content.slice(offset,offset+take);offset+=take;
      if(text.length>=limit)flush();
    }
  }
  flush();return result;
}