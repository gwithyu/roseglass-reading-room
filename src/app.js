/** Roseglass Reading Room. No backend, telemetry, credentials, or private integrations. */
import {loadReadingPosition,saveReadingPosition,clearReadingPosition} from './reading-progress.mjs';
import {loadNotes,saveNotes} from './study-notes.mjs';
import {buildTextChunks} from './segment-text.mjs';
import {makePageImage,canvasPngBlob,samePageSnapshot,buildVisualPrompt,exportSize} from './visual-packet.mjs';
import {relayImageToChat} from './chat-image-bridge.mjs';
import {makeChallenge,paintChallenge,BLIND_PROMPT} from './vision-challenge.mjs';
import {initAiChat} from './ai-chat.mjs';
const $ = (id) => document.getElementById(id);
const ui = {
  file: $('file-input'), open: $('open-file'), filename: $('filename'), kind: $('file-kind'),
  canvas: $('page-canvas'), demo: $('demo-slide'), pin: $('selection-pin'), stage: $('slide-fit'), viewport: $('slide-viewport'),
  prev: $('prev'), next: $('next'), counter: $('page-counter'), status: $('status'), zoomLabel: $('zoom-label'), zoomRange: $('zoom-range'), zoomPreset: $('zoom-preset'),
  thumbs: $('thumbs'), thumbList: $('thumb-list'), bookmarks: $('bookmarks'), bookmarkList: $('bookmark-list'),
  searchPanel: $('search-panel'), search: $('search-input'), searchResults: $('search-results'), toast: $('toast'),
  noteText: $('note-text'), noteList: $('note-list'), notesCount: $('notes-count')
};
const state = { kind: 'demo', file: null, document: null, pptx: null, page: 0, count: 1, pagesText: [],
  fileKey: null, bookmarks: new Set(), notes: [], zoom: 1, zoomMode: 'fit-page', widthZoom: 1, resumed: false, selected: null, renderToken: 0, pdfjs: null,
  searchIndexPromise: null, sendIndex: 0, sendChunks: [], awaitingManualSegment: null, sendingChunks: false, loading: false, renderTask: null, canvasPage: null, sharing: false };
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
  updateZoomUI();
  if(state.kind==='demo')persistZoom();else persistReadingPosition();
  clearTimeout(zoomTimer);
  if(live) zoomTimer=setTimeout(()=>render().catch(e=>notice('缩放失败：'+e.message)),90);
  else render().catch(e=>notice('缩放失败：'+e.message));
}


function notice(s) { ui.toast.textContent = s; ui.toast.classList.remove('hidden'); clearTimeout(notice.timer); notice.timer = setTimeout(() => ui.toast.classList.add('hidden'), 3200); }
function setStatus(s) { ui.status.textContent = s; }
function safeNumber(n) { return String(n + 1).padStart(2, '0'); }
function filenameShort(f) { return f.length > 60 ? f.slice(0, 57) + '…' : f; }
function setPanel(id, other) { const p = $(id); p.classList.toggle('hidden'); if (other && !p.classList.contains('hidden')) $(other).classList.add('hidden'); }
function safeStorage() { try { return window.localStorage; } catch { return null; } }
function persistReadingPosition() {
  if(state.kind==='demo')return;
  saveReadingPosition(safeStorage(),state.fileKey,state.count,{
    page:state.page,zoomMode:state.zoomMode,zoom:state.zoom
  });
}
function restoreReadingPosition() {
  // A previously opened DIFFERENT document must never supply a new document's defaults.
  state.page=0;state.zoomMode='fit-page';state.zoom=1;state.widthZoom=1;state.resumed=false;
  const saved=loadReadingPosition(safeStorage(),state.fileKey,state.count);
  if(saved){state.page=saved.page;state.zoomMode=saved.zoomMode;state.zoom=saved.zoom;state.resumed=true;}
}
const storeKey = () => state.fileKey ? `roseglass:v1:bookmarks:${state.fileKey}` : null;
function persistBookmarks() { const key=storeKey();if(!key)return;try { localStorage.setItem(key, JSON.stringify([...state.bookmarks])); } catch {} }
function restoreBookmarks() {const key=storeKey(); try { state.bookmarks = new Set(JSON.parse((key&&localStorage.getItem(key)) || '[]').filter(n => Number.isInteger(n) && n >= 0 && n < state.count)); } catch { state.bookmarks = new Set(); } drawBookmarks(); }
async function resetReadingPosition(){
  if(state.kind==='demo')return;
  clearReadingPosition(safeStorage(),state.fileKey);
  state.page=0;state.zoomMode='fit-page';state.zoom=1;state.selected=null;state.resumed=false;
  await render();notice('已重置本课件的阅读位置与比例');
}
function drawBookmarks() {
  const list = ui.bookmarkList; list.replaceChildren();
  if (!state.bookmarks.size) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = '还没有书签'; list.append(p); }
  for (const i of [...state.bookmarks].sort((a,b)=>a-b)) { const b=document.createElement('button'); b.textContent=`第 ${i+1} 页`; b.onclick=()=>go(i); list.append(b); }
  $('bookmark-current').textContent = state.bookmarks.has(state.page) ? '★' : '☆';
}
function restoreNotes(){state.notes=loadNotes(safeStorage(),state.fileKey,state.count);ui.noteText.value='';drawNotes();}
function drawNotes(){
  ui.noteList.replaceChildren();ui.notesCount.textContent=String(state.notes.length);
  if(!state.notes.length){const p=document.createElement('p');p.className='muted';p.textContent='还没有保存重点';ui.noteList.append(p);return;}
  for(const n of state.notes){
    const row=document.createElement('div');row.className='note-item';
    const jump=document.createElement('button');jump.className='note-jump';
    jump.textContent=`第 ${n.page+1} 页${n.x!==null?' · 已标记位置':''}${n.text?' — '+n.text:''}`;
    jump.title='跳转到这条笔记';jump.onclick=async()=>{await go(n.page);state.selected=n.x===null?null:{page:n.page,x:n.x,y:n.y};if(state.selected)showPin(n.x,n.y);else ui.pin.classList.add('hidden');};
    const remove=document.createElement('button');remove.className='note-delete';remove.textContent='×';remove.setAttribute('aria-label',`删除第 ${n.page+1} 页的这条笔记`);
    remove.onclick=()=>{state.notes=state.notes.filter(x=>x.id!==n.id);saveNotes(safeStorage(),state.fileKey,state.count,state.notes);drawNotes();};
    row.append(jump,remove);ui.noteList.append(row);
  }
}
function addNote(){
  if(state.kind==='demo')return notice('请先打开课件');
  const selected=state.selected?.page===state.page?state.selected:null;
  const content=ui.noteText.value.trim();
  if(!content&&!selected)return notice('先点击课件标记重点，或者写一段备注');
  if(state.notes.length>=300)return notice('本课件最多保存 300 条重点');
  const note={id:globalThis.crypto?.randomUUID?.().replaceAll('-','') || Date.now().toString(36)+Math.random().toString(36).slice(2),page:state.page,x:selected?.x??null,y:selected?.y??null,text:content};
  state.notes.push(note);
  if(!saveNotes(safeStorage(),state.fileKey,state.count,state.notes))notice('本地存储不可用，笔记仅在本次阅读中保留');
  else notice('重点笔记已保存在本地浏览器');
  ui.noteText.value='';drawNotes();
}
function resetPanels() { ui.searchResults.replaceChildren(); ui.searchResults.textContent = '输入关键词查找页面文字'; ui.thumbList.replaceChildren(); state.sendIndex = 0; state.sendChunks = []; state.awaitingManualSegment=null; $('confirm-segment').classList.add('hidden'); }
function switchDoc(kind, name, count) {
  state.kind = kind; state.page = 0; state.count = count; state.selected = null; state.canvasPage = null;
  ui.filename.textContent = filenameShort(name); ui.kind.textContent = kind.toUpperCase();
  ui.demo.classList.add('hidden'); ui.canvas.classList.remove('hidden'); ui.pin.classList.add('hidden');
  restoreReadingPosition(); resetPanels(); restoreBookmarks(); restoreNotes(); refreshCounter();
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
  if (!globalThis.crypto?.subtle) return null; // No insecure size-only fingerprint collision.
  const hash = await globalThis.crypto.subtle.digest('SHA-256',buffer);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2,'0')).join('').slice(0,24);
}
async function pdfLib() {
  if (!state.pdfjs) {
    // Reuse the already distributed, license-preserved PDF.js 5.6.205 assets.
    // No foreign CDN is needed to open PDFs on the public standalone reader.
    const localPdf = new URL('../mcp-reader/worker/vendor/pdf.min.mjs', import.meta.url);
    const localWorker = new URL('../mcp-reader/worker/vendor/pdf.worker.min.mjs', import.meta.url);
    state.pdfjs = await import(localPdf.href);
    state.pdfjs.GlobalWorkerOptions.workerSrc = localWorker.href;
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
    let nextPdf = null, nextPptx = null, nextText = [], nextCount = 0;
    if (ext==='pdf') {
      const pdfjs = await pdfLib();
      nextPdf = await pdfjs.getDocument({data:new Uint8Array(buffer.slice(0))}).promise;
      nextCount = nextPdf.numPages;
    } else {
      // Local-only PowerPoint renderer. PDF and PPTX dependencies are fetched as public JS modules.
      const {PptxRenderer} = await import('https://esm.sh/pptx-browser@4.1.5?bundle');
      nextPptx = new PptxRenderer();
      try {await nextPptx.load(buffer);} catch(e){nextPptx.destroy?.();throw e;}
      nextCount = nextPptx.slideCount;
      // Extract OOXML text directly, with ZIP limits, without uploading any lecture content.
      nextText = await extractPptxTexts(buffer, nextCount).catch(() => Array(nextCount).fill(''));
    }
    if (!Number.isInteger(nextCount) || nextCount < 1) throw new Error('课件中没有可阅读的页面');
    // Do not tear down a successfully opened document if a newly selected one fails.
    const previousPdf = state.document, previousPptx = state.pptx;
    state.renderToken++;
    if (state.renderTask) {try {state.renderTask.cancel();} catch {} state.renderTask=null;}
    state.document = nextPdf; state.pptx = nextPptx;
    state.file = file; state.fileKey = fileKey; state.pagesText = nextText;
    state.searchIndexPromise = null;
    switchDoc(ext, name, nextCount);
    try{previousPptx?.destroy?.();}catch{}
    if(previousPdf){try{await previousPdf.destroy();}catch{}}
    setStatus(state.resumed ? `已恢复阅读 · 第 ${state.page+1}/${state.count} 页 · ${state.zoomMode==='custom'?Math.round(state.zoom*100)+'%':state.zoomMode==='fit-width'?'适应宽度':'适应整页'}` : `本地文件 · ${state.count} 页 · 点击页面可标记重点`);
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
  state.canvasPage = null;
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
  state.canvasPage = {fileKey:state.fileKey,page:state.page,kind:state.kind,renderToken:token};
  if (state.selected && state.selected.page===state.page) showPin(state.selected.x,state.selected.y);
  refreshCounter();
}
function showPin(x,y) {
  const r=ui.canvas.getBoundingClientRect(),stage=ui.stage.getBoundingClientRect();
  ui.pin.style.left = `${r.left-stage.left+r.width*x}px`;
  ui.pin.style.top = `${r.top-stage.top+r.height*y}px`;
  ui.pin.classList.remove('hidden');
}
async function go(page) { if(!Number.isInteger(page)||page<0||page>=state.count||page===state.page)return;state.page=page;state.selected=null;persistReadingPosition();await render(); }
ui.canvas.addEventListener('click',(e)=>{
  if(state.kind==='demo')return;
  const r=ui.canvas.getBoundingClientRect(); const x=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));const y=Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));
  state.selected={page:state.page,x,y};showPin(x,y);notice('已标记重点 · 打开书签面板可保存为笔记');
});
function bookmark() {if(state.bookmarks.has(state.page))state.bookmarks.delete(state.page);else state.bookmarks.add(state.page);persistBookmarks();drawBookmarks();notice(state.bookmarks.has(state.page)?'这一页已收藏':'已取消收藏');}
async function ensurePdfText() {
  if (state.kind !== 'pdf') return;
  if (state.searchIndexPromise) return state.searchIndexPromise;
  const doc=state.document, textTarget=state.pagesText;
  const guard=()=>{if(state.document!==doc||state.pagesText!==textTarget)throw new Error('课件已经切换，旧的全文索引已取消');};
  const work=(async()=>{
    for(let i=0;i<doc.numPages;i++){
      guard();
      if(typeof textTarget[i]==='string')continue;
      const page=await doc.getPage(i+1);
      const content=await page.getTextContent();
      guard();
      textTarget[i]=content.items.map(x=>x.str||'').join(' ');
      if(i%24===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
  })();
  state.searchIndexPromise=work;
  try {return await work;} catch(e){if(state.searchIndexPromise===work)state.searchIndexPromise=null;throw e;}
}
async function pageText(i) {
  if(state.kind==='demo')return '示例页面：打开自己的 PDF 或 PPTX 开始阅读。';
  const doc=state.document, target=state.pagesText, kind=state.kind;
  if(kind==='pdf' && typeof target[i]!=='string') {
    const page=await doc.getPage(i+1), t=await page.getTextContent();
    if(state.document!==doc||state.pagesText!==target||state.kind!==kind)throw new Error('课件已经切换，请重新选择本页');
    target[i]=t.items.map(x=>x.str||'').join(' ');
  }
  return target[i] || '';
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
  const pageNotes=state.notes.filter(n=>n.page===page).map(n=>`- ${n.x===null?'整页':`位置 ${n.x.toFixed(4)}, ${n.y.toFixed(4)}`}：${n.text||'已标记重点'}`).join('\n').slice(0,2500);
  return `请与我共读这份课件，只依据实际提供的文字或图像回答，不要推测未收到的图形。\n课件：${state.file?.name||'示例'}\n格式：${state.kind.toUpperCase()}\n第 ${page+1} / ${state.count} 页${loc}\n\n===== 页面文字 =====\n${text||'（当前页没有可提取文字。图像需要另行附上，不能单凭本消息识别。）'}${pageNotes?`\n\n===== 我的本页重点笔记 =====\n${pageNotes}`:''}`;
}
async function copyPacket() {
  const text=createPacket(await pageText(state.page));try{await navigator.clipboard.writeText(text);notice('当前页文字与点击位置已复制');}catch{fallbackDownload(text,'reading-context.txt');notice('无法复制，已保存文本文件');}
}
function fallbackDownload(text,name) {const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function sendPacket(text) {
  if(window.openai?.sendFollowUpMessage) {
    await window.openai.sendFollowUpMessage({prompt:text});
    notice('已请求当前聊天接收阅读文字');
    return 'sent';
  }
  try {
    await navigator.clipboard.writeText(text);
    notice('文字已复制，尚未发送到 ChatGPT');
    return 'copied';
  } catch {
    fallbackDownload(text,'reading-context.txt');
    notice('已导出文字文件，尚未发送到 ChatGPT');
    return 'exported';
  }
}
/** Explicit transfer only; a screenshot is not silently uploaded on page navigation. */
async function captureVisualPage(){
  if(state.kind==='demo')throw new Error('请先打开自己的 PDF 或 PPTX');
  const snapshot = {fileKey:state.fileKey,page:state.page,kind:state.kind};
  if(!state.canvasPage || !samePageSnapshot({...snapshot,renderToken:state.canvasPage.renderToken},state.canvasPage)){
    await render();
  }
  if(!state.canvasPage || !samePageSnapshot(state.canvasPage,{...snapshot,renderToken:state.renderToken}))throw new Error('页面正在切换，请稍后再试');
  // Export from the underlying document at high resolution, independent of mobile zoom.
  const selected=state.selected?.page===snapshot.page?{x:state.selected.x,y:state.selected.y}:null;
  const raw=document.createElement('canvas');
  if(snapshot.kind==='pdf'){
    const documentRef=state.document;
    const page=await documentRef.getPage(snapshot.page+1);
    const natural=page.getViewport({scale:1});
    const size=exportSize(natural.width,natural.height);
    const viewport=page.getViewport({scale:size.scale});
    raw.width=size.width;raw.height=size.height;
    await page.render({canvasContext:raw.getContext('2d',{alpha:false}),viewport}).promise;
  } else {
    const deckRef=state.pptx;
    await deckRef.renderSlide(snapshot.page,raw,2400);
  }
  if(state.fileKey!==snapshot.fileKey || state.page!==snapshot.page || state.kind!==snapshot.kind)throw new Error('课件已切换，请重新操作');
  const imageCanvas=makePageImage(raw,selected);
  const blob=await canvasPngBlob(imageCanvas);
  if(state.fileKey!==snapshot.fileKey || state.page!==snapshot.page || state.kind!==snapshot.kind)throw new Error('课件已切换，请重新操作');
  return {blob, snapshot, focus:selected};
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function exportCurrentImage(){
  const {blob,snapshot}=await captureVisualPage();
  downloadBlob(blob,`slide-${snapshot.page+1}-marked.png`);
  notice('已导出真实页面 PNG；可直接拖进聊天');
}
async function manualVisualFallback(blob,pageContext,page){
  downloadBlob(blob,`slide-${page+1}-marked.png`);
  try{await navigator.clipboard.writeText(buildVisualPrompt(pageContext,false));notice('ChatGPT 当前无法直接附图：已下载 PNG 并复制文字，请手动上传图片');}
  catch{fallbackDownload(buildVisualPrompt(pageContext,false),'reading-context.txt');notice('ChatGPT 当前无法直接附图：请上传下载的 PNG 与文字文件');}
}
async function sendCurrent(){
  if(state.sharing)return notice('正在准备当前页图像，请稍候');
  state.sharing=true;$('send-chat').disabled=true;
  try{
    setStatus('正在准备真实页面图像和点击位置…');
    const {blob,snapshot}=await captureVisualPage();
    const docAtCapture=state.document, pptAtCapture=state.pptx;
    const extracted=await pageText(snapshot.page);
    const stillCurrent=()=>snapshot.fileKey===state.fileKey && snapshot.page===state.page && snapshot.kind===state.kind && docAtCapture===state.document && pptAtCapture===state.pptx;
    if(!stillCurrent())throw new Error('页面已切换，旧图像不会发送');
    const context=createPacket(extracted,snapshot.page);
    const result=await relayImageToChat({
      host:window.openai,blob,fileName:`slide-${snapshot.page+1}.png`,
      prompt:buildVisualPrompt(context,true),
      modelContent:`阅读器请求共享第 ${snapshot.page+1} 页的页面图像；请核实像素真实可见，不可仅凭文字推断。`,
      privateContent:{page:snapshot.page+1},canProceed:stillCurrent,
      onPhase:phase=>{if(phase==='uploaded')setStatus('图片已上传；尚未证明模型看到像素');
        else if(phase==='linked')setStatus('图片引用已设置；正在请求当前聊天回应');}
    });
    if(result.status==='cancelled'){setStatus('检测到课件切换，已取消发送旧页面');notice('课件已切换，未发送过期页面');return;}
    if(result.status==='followup_requested'){
      setStatus('已请求聊天回应，但模型是否看到图像仍待盲测确认');
      notice('已请求图文共读；请以聊天对图像内容的回答为准');
    }else{
      await manualVisualFallback(blob,context,snapshot.page);
      setStatus('自动图像提交失败或不可用，已导出 PNG 供手动上传');
    }
  } finally {state.sharing=false;$('send-chat').disabled=false;}
}

let visionSequence=0;
function makeNewVisionChallenge(){
  const panel=$('vision-canvas');
  paintChallenge(panel,makeChallenge());
  visionSequence++;
  $('vision-status').textContent='已生成只含图片答案的盲测页。点击发送后，要求聊天读出 KEY、中央图形和四格颜色。';
}
async function sendVisionChallenge(){
  if(state.sharing)return notice('图像正在处理，请稍后');
  const seq=visionSequence;
  if(!seq){makeNewVisionChallenge();return;}
  state.sharing=true;$('send-vision').disabled=true;
  const status=$('vision-status');
  try {
    const png=await canvasPngBlob($('vision-canvas'));
    const result=await relayImageToChat({host:window.openai,blob:png,
      fileName:'visual-receipt-test.png',prompt:BLIND_PROMPT,
      modelContent:'这是一张图片像素盲测页。请先确认实际图像是否可见；KEY、形状与四格颜色均没有在文字中提供。',
      privateContent:{test:'image-receipt'},canProceed:()=>seq===visionSequence,
      onPhase:phase=>{status.textContent=phase==='uploaded'?'图像已上传到宿主，但模型是否能看见仍未知。':'图像引用已设置；尚未收到模型的视觉回答。';}
    });
    if(result.status==='cancelled'){status.textContent='挑战页已更新，旧图像提交已取消。';return;}
    if(result.status==='followup_requested'){
      status.textContent='已请求 Chat 回复，等待验证：必须正确读出图片 KEY、中央形状与四格颜色才算成功。';
      notice('盲测已发起；请检查聊天实际回答，而不是上传回执');
    }else{
      downloadBlob(png,'visual-receipt-test.png');
      try{await navigator.clipboard.writeText(BLIND_PROMPT);status.textContent='宿主无法自动附图，已导出盲测 PNG 并复制问题，请将 PNG 拖进当前聊天。';}
      catch{status.textContent='宿主无法自动附图，已导出盲测 PNG；请把图片拖进聊天并询问图中 KEY、形状和四格颜色。';}
    }
  } catch(error){status.textContent='盲测准备失败：'+(error?.message||'未知错误');}
  finally{state.sharing=false;$('send-vision').disabled=false;}
}

async function sendFullChunks() {
  if(state.kind==='demo')return notice('请先打开课件');
  if(state.sendingChunks)return notice('正在准备上一段，请稍候');
  if(state.awaitingManualSegment!==null)return notice('本段尚未确认粘贴，请先点「已粘贴，下一段」');
  state.sendingChunks=true;
  const doc=state.document,pptx=state.pptx,key=state.fileKey,pages=state.pagesText;
  const current=()=>state.document===doc&&state.pptx===pptx&&state.fileKey===key&&state.pagesText===pages;
  try {
    setStatus('正在建立全文分段…');await ensurePdfText();
    if(!current())throw new Error('课件已经切换，旧全文不会发送');
    if(!state.sendChunks.length)state.sendChunks=buildTextChunks(pages,MAX_SEGMENT);
    if(state.sendIndex>=state.sendChunks.length){state.sendIndex=0;notice('全文已处理完毕；再次点击可从第一段重新开始');return;}
    const k=state.sendIndex,part=state.sendChunks[k];
    const text=`课件全文分段 ${k+1}/${state.sendChunks.length}，覆盖第 ${part.from}–${part.to} 页。请关联此前分段，并保留页码。仅根据这些实际文字讨论；无文字层的图像需单独上传。\n课件：${state.file.name}\n${part.text}`;
    const outcome=await sendPacket(text);
    if(!current())throw new Error('课件已经切换，旧全文的结果已丢弃');
    if(outcome==='sent') {
      state.sendIndex++;
      setStatus(`已请求 Chat 接收全文第 ${state.sendIndex}/${state.sendChunks.length} 段`);
    } else {
      state.awaitingManualSegment=k;
      $('confirm-segment').classList.remove('hidden');
      setStatus(`第 ${k+1}/${state.sendChunks.length} 段已${outcome==='copied'?'复制':'导出'}，尚未发送；粘贴进 Chat 后请确认`);
    }
  } finally {state.sendingChunks=false;}
}
function confirmManualSegment(){
  if(state.awaitingManualSegment===null)return;
  state.sendIndex=state.awaitingManualSegment+1;
  state.awaitingManualSegment=null;
  $('confirm-segment').classList.add('hidden');
  setStatus(`已由你确认粘贴第 ${state.sendIndex}/${state.sendChunks.length} 段；下一段就绪`);
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
$('reset-reading').onclick=()=>resetReadingPosition().catch(e=>notice('重置失败：'+e.message));
$('save-note').onclick=addNote;
$('bookmark-current').onclick=bookmark;$('copy-context').onclick=()=>copyPacket().catch(e=>notice(e.message));
$('send-chat').onclick=()=>sendCurrent().catch(e=>notice('发送失败：'+e.message));
$('export-image').onclick=()=>exportCurrentImage().catch(e=>notice('图片导出失败：'+e.message));
$('toggle-vision-test').onclick=()=>{const panel=$('vision-panel');panel.classList.toggle('hidden');if(!panel.classList.contains('hidden')&&!visionSequence)makeNewVisionChallenge();};
$('close-vision-test').onclick=()=>$('vision-panel').classList.add('hidden');
$('regenerate-vision').onclick=makeNewVisionChallenge;
$('download-vision').onclick=async()=>{if(!visionSequence)makeNewVisionChallenge();const png=await canvasPngBlob($('vision-canvas'));downloadBlob(png,'visual-receipt-test.png');$('vision-status').textContent='已下载实际图像 PNG；把图像拖进聊天可测试手动送达。';};
$('send-vision').onclick=sendVisionChallenge;

$('zoom-in').onclick=()=>setZoom('custom',(state.zoomMode==='fit-page'?1:state.zoomMode==='fit-width'?state.widthZoom:state.zoom)+ZOOM_STEP);
$('zoom-out').onclick=()=>setZoom('custom',(state.zoomMode==='fit-page'?1:state.zoomMode==='fit-width'?state.widthZoom:state.zoom)-ZOOM_STEP);
ui.zoomRange.addEventListener('input',()=>setZoom('custom',Number(ui.zoomRange.value)/100,true));
ui.zoomRange.addEventListener('change',()=>setZoom('custom',Number(ui.zoomRange.value)/100));
ui.zoomPreset.addEventListener('change',()=>setZoom(ui.zoomPreset.value));
$('fullscreen').onclick=async()=>{if(window.openai?.requestDisplayMode){try{await window.openai.requestDisplayMode({mode:'fullscreen'});return;}catch{}}if(!document.fullscreenElement)await document.documentElement.requestFullscreen?.();else await document.exitFullscreen?.();};
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'') || document.activeElement?.isContentEditable)return;if(e.key==='ArrowRight'||e.key==='PageDown')go(state.page+1);if(e.key==='ArrowLeft'||e.key==='PageUp')go(state.page-1);if((e.metaKey||e.ctrlKey)&&e.key==='f'){e.preventDefault();ui.searchPanel.classList.remove('hidden');ui.search.focus();}});
initAiChat({notice,getContext:async({includeImage})=>{
  if(state.kind==='demo' || !state.fileKey)throw new Error('请先打开一份 PDF 或 PPTX');
  const documentKey=state.fileKey, page=state.page, documentRef=state.document, pptRef=state.pptx;
  const extracted=await pageText(page);
  const unchanged=()=>documentKey===state.fileKey && page===state.page && documentRef===state.document && pptRef===state.pptx;
  if(!unchanged())throw new Error('课件已切换，请重新发送');
  const text=createPacket(extracted,page);
  let image=null;
  if(includeImage){
    const visual=await captureVisualPage();
    if(!unchanged() || visual.snapshot.page!==page)throw new Error('课件已切换，取消发送旧图像');
    image=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result));
      reader.onerror=()=>reject(new Error('图片读取失败'));
      reader.readAsDataURL(visual.blob);
    });
    if(!unchanged())throw new Error('课件已切换，取消发送旧图像');
  }
  return {documentKey,text,image};
}});
restoreZoom();updateZoomUI();renderDemo();
let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>render(),110);}).observe(ui.viewport);
let dragDepth=0;window.addEventListener('dragenter',e=>{if(!e.dataTransfer?.types?.includes('Files'))return;e.preventDefault();dragDepth++;$('drop-hint').classList.remove('hidden');});window.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});window.addEventListener('dragleave',()=>{dragDepth--;if(dragDepth<=0){dragDepth=0;$('drop-hint').classList.add('hidden');}});window.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-hint').classList.add('hidden');loadFile(e.dataTransfer?.files?.[0]);});
// Public demo enhancement: let users read a synthetic slide with zero network access.
$('copy-context').insertAdjacentHTML('beforebegin','<button id="send-full" class="bottom-button secondary" title="发送或复制下一段全文">全文分段 ↗</button><button id="confirm-segment" class="bottom-button secondary hidden" title="确认已把本段粘贴进当前聊天">已粘贴，下一段 ✓</button>');
$('send-full').onclick=()=>sendFullChunks().catch(e=>notice('全文分段失败：'+e.message));
$('confirm-segment').onclick=confirmManualSegment;
setStatus('浏览器本地阅读 · 无后台上传 · 选 PDF/PPTX 开始');