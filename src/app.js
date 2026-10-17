/** Roseglass Reading Room. No backend, telemetry, credentials, or private integrations. */
const $ = (id) => document.getElementById(id);
const ui = {
  file: $('file-input'), open: $('open-file'), filename: $('filename'), kind: $('file-kind'),
  canvas: $('page-canvas'), demo: $('demo-slide'), pin: $('selection-pin'), stage: $('slide-fit'), viewport: $('slide-viewport'),
  prev: $('prev'), next: $('next'), counter: $('page-counter'), status: $('status'), zoomLabel: $('zoom-label'), zoomRange: $('zoom-range'), zoomPreset: $('zoom-preset'),
  thumbs: $('thumbs'), thumbList: $('thumb-list'), bookmarks: $('bookmarks'), bookmarkList: $('bookmark-list'),
  searchPanel: $('search-panel'), search: $('search-input'), searchResults: $('search-results'), toast: $('toast')
};
const state = { kind: 'demo', file: null, document: null, pptx: null, page: 0, count: 1, pagesText: [],
  fileKey: 'demo', bookmarks: new Set(), zoom: 1, zoomMode: 'fit-page', widthZoom: 1, selected: null, renderToken: 0, pdfjs: null,
  searchIndexPromise: null, sendIndex: 0, sendChunks: [], loading: false, renderTask: null };
const MAX_SEGMENT = 9000;
const ZOOM_MIN = 0.5, ZOOM_MAX = 3, ZOOM_STEP = 0.1;
const ZOOM_STORAGE = 'roseglass:v1:zoom';
const zoomMath = {
  clamp(value) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value)); },
  fit(w, h, availW, availH) { return Math.min(availW/w, availH/h); },
  scale(mode, zoom, w, h, availW, availH) {
    const fit=this.fit(w,h,availW,availH);
    return mode === 'fit-width' ? availW/w : fit*(mode==='custom' ? zoom : 1);
  }
};
function restoreZoom() {
  try {
    const value=JSON.parse(localStorage.getItem(ZOOM_STORAGE)||'null');
    if(['fit-page','fit-width','custom'].includes(value?.mode)) state.zoomMode=value.mode;
    if(Number.isFinite(value?.zoom)) state.zoom=zoomMath.clamp(value.zoom);
  } catch { /* Storage is optional in sandboxed hosts */ }
}
function persistZoom() {
  try { localStorage.setItem(ZOOM_STORAGE,JSON.stringify({mode:state.zoomMode,zoom:state.zoom})); } catch {}
}
function updateZoomUI() {
  ui.zoomPreset.value=state.zoomMode;
  const ratio=state.zoomMode==='fit-width'?state.widthZoom:(state.zoomMode==='fit-page'?1:state.zoom);
  ui.zoomRange.value=String(Math.round(zoomMath.clamp(ratio)*100));
  const label=state.zoomMode==='fit-page'?'整页':state.zoomMode==='fit-width'?'宽度':`${Math.round(state.zoom*100)}%`;
  ui.zoomLabel.textContent=label;
  ui.zoomRange.setAttribute('aria-label',`课件大小，相当于整页适配的 ${Math.round(ratio*100)}%`);
  ui.zoomLabel.title='自定义比例以适应整页尺寸为 100% 基准';
}
let zoomTimer;
function setZoom(mode, zoom=state.zoom, live=false) {
  state.zoomMode=mode;
  state.zoom=zoomMath.clamp(Math.round(zoom*10)/10);
  updateZoomUI();persistZoom();
  clearTimeout(zoomTimer);
  if(live) zoomTimer=setTimeout(()=>render().catch(e=>notice('缩放失败：'+e.message)),90);
  else render().catch(e=>notice('缩放失败：'+e.message));
}


function notice(s) { ui.toast.textContent = s; ui.toast.classList.remove('hidden'); clearTimeout(notice.timer); notice.timer = setTimeout(() => ui.toast.classList.add('hidden'), 3200); }
function setStatus(s) { ui.status.textContent = s; }
function safeNumber(n) { return String(n + 1).padStart(2, '0'); }
function filenameShort(f) { return f.length > 60 ? f.slice(0, 57) + '…' : f; }
function setPanel(id, other) { const p = $(id); p.classList.toggle('hidden'); if (other && !p.classList.contains('hidden')) $(other).classList.add('hidden'); }
const storeKey = () => `roseglass:v1:bookmarks:${state.fileKey}`;
function persistBookmarks() { try { localStorage.setItem(storeKey(), JSON.stringify([...state.bookmarks])); } catch {} }
function restoreBookmarks() { try { state.bookmarks = new Set(JSON.parse(localStorage.getItem(storeKey()) || '[]').filter(n => Number.isInteger(n) && n >= 0 && n < state.count)); } catch { state.bookmarks = new Set(); } drawBookmarks(); }
function drawBookmarks() {
  const list = ui.bookmarkList; list.replaceChildren();
  if (!state.bookmarks.size) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '还没有书签'; list.append(p); }
  for (const i of [...state.bookmarks].sort((a,b)=>a-b)) { const b=document.createElement('button'); b.textContent=`第 ${i+1} 页`; b.onclick=()=>go(i); list.append(b); }
  $('bookmark-current').textContent = state.bookmarks.has(state.page) ? '★' : '☆';
}
function resetPanels() { ui.searchResults.replaceChildren(); ui.searchResults.textContent = '输入关键词查找页面文字'; ui.thumbList.replaceChildren(); state.sendIndex = 0; state.sendChunks = []; }
function switchDoc(kind, name, count) {
  state.kind = kind; state.page = 0; state.count = count; state.selected = null;
  ui.filename.textContent = filenameShort(name); ui.kind.textContent = kind.toUpperCase();
  ui.demo.classList.add('hidden'); ui.canvas.classList.remove('hidden'); ui.pin.classList.add('hidden');
  resetPanels(); restoreBookmarks(); refreshCounter();
}
function refreshCounter() {
  ui.counter.innerHTML = `${safeNumber(state.page)} <em>/</em> ${safeNumber(state.count-1)}`;
  updateZoomUI();
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page === state.count - 1;
  ui.thumbList.querySelectorAll('.thumb-item').forEach((b,i)=>b.classList.toggle('active',i===state.page));
  drawBookmarks();
}
async function idForFile(buffer) {
  if (!crypto?.subtle) return `local-${buffer.byteLength}`;
  const hash = await crypto.subtle.digest('SHA-256',buffer);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2,'0')).join('').slice(0,24);
}
async function pdfLib() {
  if (!state.pdfjs) {
    const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/';
    state.pdfjs = await import(base+'pdf.mjs');
    state.pdfjs.GlobalWorkerOptions.workerSrc = base+'pdf.worker.mjs';
  }
  return state.pdfjs;
}
async function loadFile(file) {
  if (!file) return;
  const name = file.name; const ext = name.split('.').pop().toLowerCase();
  if (!['pdf','pptx'].includes(ext)) { notice('目前支持 PDF 和 PPTX；旧版 .ppt 请先另存为 .pptx'); return; }
  if (state.loading) { notice('请等待当前课件加载完成'); return; }
  state.loading = true; setStatus('正在本地读取课件…');
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > 250 * 1024 * 1024) throw new Error('文件超过 250 MB 浏览器预览限制');
    const fileKey = await idForFile(buffer);
    state.pptx?.destroy?.(); state.pptx = null;
    if (state.document) { try { await state.document.destroy(); } catch {} state.document=null; }
    state.file = file; state.fileKey = fileKey; state.pagesText = [];
    if (ext==='pdf') {
      const pdfjs = await pdfLib();
      const doc = await pdfjs.getDocument({data:new Uint8Array(buffer.slice(0))}).promise;
      state.document = doc; switchDoc('pdf',name,doc.numPages);
      state.searchIndexPromise = null;
    } else {
      // Local-only PowerPoint renderer. PDF and PPTX dependencies are fetched as public JS modules.
      const {PptxRenderer} = await import('https://esm.sh/pptx-browser@4.1.5?bundle');
      const p = new PptxRenderer(); await p.load(buffer);
      state.pptx = p; switchDoc('pptx',name,p.slideCount);
      // Extract OOXML text directly, with ZIP limits, without uploading any lecture content.
      state.pagesText = await extractPptxTexts(buffer, p.slideCount).catch(() => Array(p.slideCount).fill(''));
    }
    setStatus(`本地文件 · ${state.count} 页 · 点击页面可标记重点`);
    await render();
    if (!ui.thumbs.classList.contains('hidden')) await populateThumbs();
  } catch (e) { console.error('Local viewer error:',e); notice('读取失败：'+(e?.message||'未知错误')); setStatus('打开失败，请检查文件格式或网络依赖'); }
  finally { state.loading=false; }
}
function fitScale(pageW,pageH) {
  const r=ui.viewport.getBoundingClientRect();
  const availW=Math.max(50,r.width-28),availH=Math.max(50,r.height-96);
  state.widthZoom=(availW/pageW)/zoomMath.fit(pageW,pageH,availW,availH);
  return zoomMath.scale(state.zoomMode,state.zoom,pageW,pageH,availW,availH);
}
function renderDemo() {
  const r=ui.viewport.getBoundingClientRect();
  const w=fitScale(16,9)*16;
  ui.demo.style.width=`${Math.round(w)}px`;
  ui.demo.style.height=`${Math.round(w*9/16)}px`;
  updateZoomUI();
}
async function render() {
  if(state.kind==='demo'){renderDemo();return;}
  if(!state.document && !state.pptx)return;
  const token = ++state.renderToken;
  if (state.renderTask) { try { state.renderTask.cancel(); } catch {} state.renderTask=null; }
  ui.pin.classList.add('hidden');
  const canvas = ui.canvas;
  const ctx = canvas.getContext('2d', {alpha:false});
  if (state.kind==='pdf') {
    const page = await state.document.getPage(state.page+1);
    if (token!==state.renderToken) return;
    const natural = page.getViewport({scale:1});
    const cssScale = fitScale(natural.width,natural.height);
    // Bound pixel count so large zoom levels remain scrollable without exhausting GPU memory.
    const cssW=natural.width*cssScale,cssH=natural.height*cssScale;
    const maxDpr=Math.sqrt(22_000_000/Math.max(1,cssW*cssH));
    const dpr=Math.max(0.5,Math.min(2,devicePixelRatio||1,maxDpr));
    const vp = page.getViewport({scale:cssScale*dpr});
    canvas.width=Math.floor(vp.width); canvas.height=Math.floor(vp.height);
    canvas.style.width=`${vp.width/dpr}px`;canvas.style.height=`${vp.height/dpr}px`;
    try { const task=page.render({canvasContext:ctx,viewport:vp}); state.renderTask=task; await task.promise; }
    catch (e) { if (e?.name==='RenderingCancelledException') return; throw e; }
    finally { if (token===state.renderToken) state.renderTask=null; }
    if (token!==state.renderToken) return;
  } else {
    const ratio=16/9;
    const w=Math.max(100,Math.floor(fitScale(16,9)*16));
    const pixels=Math.min(4096,Math.max(960,Math.round(w*Math.min(2,devicePixelRatio||1))));
    await state.pptx.renderSlide(state.page,canvas,pixels);
    if(token!==state.renderToken)return;
    canvas.style.width=w+'px';canvas.style.height=Math.round(w*(canvas.height/canvas.width||9/16))+'px';
  }
  if (state.selected && state.selected.page===state.page) showPin(state.selected.x,state.selected.y);
  refreshCounter();
}
function showPin(x,y) {
  const r=ui.canvas.getBoundingClientRect(),stage=ui.stage.getBoundingClientRect();
  ui.pin.style.left = `${r.left-stage.left+r.width*x}px`;
  ui.pin.style.top = `${r.top-stage.top+r.height*y}px`;
  ui.pin.classList.remove('hidden');
}
async function go(page) { if(page<0 || page>=state.count)return;state.page=page;state.selected=null;await render(); }
ui.canvas.addEventListener('click',(e)=>{
  if(state.kind==='demo')return;
  const r=ui.canvas.getBoundingClientRect(); const x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));const y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
  state.selected={page:state.page,x,y};showPin(x,y);notice('已标记重点 · 发送到聊天时将附上位置');
});
function bookmark() {if(state.bookmarks.has(state.page))state.bookmarks.delete(state.page);else state.bookmarks.add(state.page);persistBookmarks();drawBookmarks();notice(state.bookmarks.has(state.page)?'这一页已收藏':'已取消收藏');}
async function ensurePdfText() {
  if (state.kind!=='pdf')return;
  if (state.searchIndexPromise) return state.searchIndexPromise;
  const doc=state.document; state.searchIndexPromise=(async()=>{
    for(let i=0;i<doc.numPages;i++) {
      const page=await doc.getPage(i+1);
      const content=await page.getTextContent();
      state.pagesText[i]=content.items.map(x=>x.str||'').join(' ');
    }
  })();
  return state.searchIndexPromise;
}
async function pageText(i) {
  if(state.kind==='demo')return '示例页面：打开自己的 PDF 或 PPTX 开始阅读。';
  if(state.kind==='pdf' && !state.pagesText[i]) {
    const page=await state.document.getPage(i+1);const t=await page.getTextContent();
    state.pagesText[i]=t.items.map(x=>x.str||'').join(' ');
  }
  return state.pagesText[i] || '';
}
async function search() {
  const q=ui.search.value.trim();ui.searchResults.replaceChildren(); if(!q)return;
  ui.searchResults.textContent='检索中…';
  try{await ensurePdfText();const hits=[];for(let i=0;i<state.count;i++){const s=(state.pagesText[i]||'');const offset=s.toLowerCase().indexOf(q.toLowerCase());if(offset!==-1)hits.push({page:i,summary:s.slice(Math.max(0,offset-45),offset+q.length+90)});}
    ui.searchResults.replaceChildren();if(!hits.length){ui.searchResults.textContent='没有找到匹配内容（部分图像扫描文件可能无文字层）';return;}
    hits.slice(0,150).forEach(h=>{const b=document.createElement('button');b.className='search-hit';const l=document.createElement('small');l.textContent=`第 ${h.page+1} 页`;const t=document.createElement('span');t.textContent=h.summary;b.append(l,t);b.onclick=()=>{go(h.page);ui.searchPanel.classList.add('hidden');};ui.searchResults.append(b);});
    if(hits.length>150){const p=document.createElement('p');p.className='muted';p.textContent=`显示前 150 条，共 ${hits.length} 条`;ui.searchResults.append(p);}
  }catch(e){ui.searchResults.textContent='全文索引失败：'+(e?.message||'未知错误');}
}
async function populateThumbs() {
  if(state.kind==='demo')return;
  const list=ui.thumbList;list.replaceChildren();
  // Lazy thumbnails keep the reading canvas dominant and avoid huge PDF memory use.
  for(let i=0;i<state.count;i++) {
    const b=document.createElement('button');b.className='thumb-item'+(i===state.page?' active':'');
    const c=document.createElement('canvas');const s=document.createElement('span');s.textContent=String(i+1);b.append(c,s);b.onclick=()=>go(i);list.append(b);
  }
  const observer=new IntersectionObserver(async entries=>{
    for(const entry of entries){if(!entry.isIntersecting)continue;const b=entry.target;observer.unobserve(b);const i=[...list.children].indexOf(b);const c=b.querySelector('canvas');
      try {if(state.kind==='pdf') {const page=await state.document.getPage(i+1);const vp=page.getViewport({scale:110/page.getViewport({scale:1}).width});c.width=vp.width;c.height=vp.height;await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;}
      else await state.pptx.renderSlide(i,c,150);
      }catch{b.title='预览不可用';}
    }
  },{root:list,rootMargin:'240px'});
  [...list.children].forEach(b=>observer.observe(b));
}
function createPacket(text, page=state.page) {
  const loc=state.selected && state.selected.page===page ? `\n点击重点（归一化坐标）：${state.selected.x.toFixed(4)}, ${state.selected.y.toFixed(4)}` : '';
  return `请与我共读这份课件，只依据实际提供的文字或图像回答，不要推测未收到的图形。\n课件：${state.file?.name||'示例'}\n格式：${state.kind.toUpperCase()}\n第 ${page+1} / ${state.count} 页${loc}\n\n===== 页面文字 =====\n${text||'（当前页没有可提取文字。图像需要另行附上，不能单凭本消息识别。）'}`;
}
async function copyPacket() {
  const text=createPacket(await pageText(state.page));try{await navigator.clipboard.writeText(text);notice('当前页文字与点击位置已复制');}catch{fallbackDownload(text,'reading-context.txt');notice('无法复制，已保存文本文件');}
}
function fallbackDownload(text,name) {const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function sendPacket(text) {
  if(window.openai?.sendFollowUpMessage) {await window.openai.sendFollowUpMessage({prompt:text});notice('已发送阅读上下文到当前聊天');return;}
  try{await navigator.clipboard.writeText(text);notice('已复制：粘贴到聊天中继续共读');}
  catch{fallbackDownload(text,'reading-context.txt');notice('当前环境无法直连聊天，已导出文字');}
}
async function sendCurrent() {const t=await pageText(state.page);await sendPacket(createPacket(t));}
async function sendFullChunks() {
  if(state.kind==='demo')return notice('请先打开课件');
  setStatus('正在建立全文分段…'); await ensurePdfText();
  if (!state.sendChunks.length) {
    const chunks=[];let segment='';let firstPage=0;
    for(let i=0;i<state.count;i++) {
      const line=`\n\n===== 第 ${i+1} 页 =====\n${state.pagesText[i]||'（无可提取文字）'}`;
      if(segment.length && segment.length+line.length>MAX_SEGMENT){chunks.push({from:firstPage+1,to:i,text:segment});segment='';firstPage=i;}
      if(line.length>MAX_SEGMENT){for(let j=0;j<line.length;j+=MAX_SEGMENT)chunks.push({from:i+1,to:i+1,text:line.slice(j,j+MAX_SEGMENT)});firstPage=i+1;}
      else segment+=line;
    }
    if(segment)chunks.push({from:firstPage+1,to:state.count,text:segment});state.sendChunks=chunks;
  }
  if(state.sendIndex>=state.sendChunks.length){state.sendIndex=0;notice('全文分段已全部发送；再次点击可重发');return;}
  const k=state.sendIndex,part=state.sendChunks[k];
  const text=`课件全文分段 ${k+1}/${state.sendChunks.length}，覆盖第 ${part.from}–${part.to} 页。请关联此前分段，并保留页码。仅根据这些实际文字讨论；无文字层的图像需单独上传。\n课件：${state.file.name}\n${part.text}`;
  await sendPacket(text);state.sendIndex++;
  setStatus(`全文分段进度 ${state.sendIndex}/${state.sendChunks.length} · 可继续发送下一段`);
}
// Lightweight OOXML text extraction. Supports deflated and stored ZIP entries, rejects extreme expansion.
async function extractPptxTexts(arrayBuffer, count) {
  const data=new Uint8Array(arrayBuffer);const dv=new DataView(arrayBuffer);const dec=new TextDecoder();
  const out=Array(count).fill(''); let pos=data.length-22, end=-1;
  for(let i=pos;i>=Math.max(0,data.length-65557);i--){if(dv.getUint32(i,true)===0x06054b50){end=i;break;}}
  if(end<0)throw new Error('PPTX ZIP directory missing');
  let offset=dv.getUint32(end+16,true), entries=Math.min(dv.getUint16(end+10,true),3000);
  const targets=new Map();
  for(let i=0;i<entries;i++) {
    if(offset+46>data.length || dv.getUint32(offset,true)!==0x02014b50)break;
    const method=dv.getUint16(offset+10,true),packed=dv.getUint32(offset+20,true),raw=dv.getUint32(offset+24,true);
    const nameLen=dv.getUint16(offset+28,true),extra=dv.getUint16(offset+30,true),comment=dv.getUint16(offset+32,true);
    const name=dec.decode(data.subarray(offset+46,offset+46+nameLen));const m=/^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    if(m && Number(m[1])<=count && raw<6_000_000)targets.set(Number(m[1])-1,{method,packed,raw,local:dv.getUint32(offset+42,true)});
    offset+=46+nameLen+extra+comment;
  }
  for(const [index,item] of targets){
    const p=item.local;if(p+30>data.length || dv.getUint32(p,true)!==0x04034b50)continue;
    const start=p+30+dv.getUint16(p+26,true)+dv.getUint16(p+28,true);
    if(start+item.packed>data.length)continue;
    let bytes=data.slice(start,start+item.packed);
    if(item.method===8){if(!('DecompressionStream'in window))continue;const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));bytes=new Uint8Array(await new Response(stream).arrayBuffer());}
    else if(item.method!==0)continue;
    if(bytes.length>6_000_000)continue;
    const xml=new DOMParser().parseFromString(dec.decode(bytes),'application/xml');
    const texts=[...xml.getElementsByTagName('*')].filter(el=>el.localName==='t').map(el=>el.textContent||'');
    out[index]=texts.join(' ');
  }
  return out;
}
ui.open.addEventListener('click',()=>ui.file.click());ui.file.addEventListener('change',()=>{loadFile(ui.file.files[0]);ui.file.value='';});
$('prev').onclick=()=>go(state.page-1);$('next').onclick=()=>go(state.page+1);
$('toggle-thumbs').onclick=async()=>{setPanel('thumbs','bookmarks');if(!ui.thumbs.classList.contains('hidden'))await populateThumbs();};
$('toggle-bookmarks').onclick=()=>setPanel('bookmarks','thumbs');$('close-bookmarks').onclick=()=>ui.bookmarks.classList.add('hidden');
$('toggle-search').onclick=()=>{ui.searchPanel.classList.toggle('hidden');if(!ui.searchPanel.classList.contains('hidden'))ui.search.focus();};
$('search-go').onclick=search;ui.search.onkeydown=e=>{if(e.key==='Enter')search();};
$('bookmark-current').onclick=bookmark;$('copy-context').onclick=()=>copyPacket().catch(e=>notice(e.message));
$('send-chat').onclick=()=>sendCurrent().catch(e=>notice('发送失败：'+e.message));
$('zoom-in').onclick=()=>setZoom('custom',(state.zoomMode==='fit-page'?1:state.zoomMode==='fit-width'?state.widthZoom:state.zoom)+ZOOM_STEP);
$('zoom-out').onclick=()=>setZoom('custom',(state.zoomMode==='fit-page'?1:state.zoomMode==='fit-width'?state.widthZoom:state.zoom)-ZOOM_STEP);
ui.zoomRange.addEventListener('input',()=>setZoom('custom',Number(ui.zoomRange.value)/100,true));
ui.zoomRange.addEventListener('change',()=>setZoom('custom',Number(ui.zoomRange.value)/100));
ui.zoomPreset.addEventListener('change',()=>setZoom(ui.zoomPreset.value));
$('fullscreen').onclick=async()=>{if(window.openai?.requestDisplayMode){try{await window.openai.requestDisplayMode({mode:'fullscreen'});return;}catch{}}if(!document.fullscreenElement)await document.documentElement.requestFullscreen?.();else await document.exitFullscreen?.();};
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA/.test(document.activeElement?.tagName||''))return;if(e.key==='ArrowRight'||e.key==='PageDown')go(state.page+1);if(e.key==='ArrowLeft'||e.key==='PageUp')go(state.page-1);if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();ui.searchPanel.classList.remove('hidden');ui.search.focus();}});
restoreZoom();updateZoomUI();renderDemo();
let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>render(),110);}).observe(ui.viewport);
let dragDepth=0;window.addEventListener('dragenter',e=>{if(!e.dataTransfer?.types?.includes('Files'))return;e.preventDefault();dragDepth++;$('drop-hint').classList.remove('hidden');});window.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});window.addEventListener('dragleave',()=>{dragDepth--;if(dragDepth<=0){dragDepth=0;$('drop-hint').classList.add('hidden');}});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-hint').classList.add('hidden');loadFile(e.dataTransfer?.files?.[0]);});
// Public demo enhancement: let users read a synthetic slide with zero network access.
$('copy-context').insertAdjacentHTML('beforebegin','<button id="send-full" class="bottom-button secondary" title="发送全部课件的下一段">全文分段 ↗</button>');
$('send-full').onclick=()=>sendFullChunks().catch(e=>notice('全文分段失败：'+e.message));
setStatus('浏览器本地阅读 · 无后台上传 · 选 PDF/PPTX 开始');