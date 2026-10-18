import { pointFromClient, regionFromClient, validRegion, makeSelection, buildReadingMessage, captureSelectionImage } from './reading-selection-geometry.mjs';

/**
 * Selection overlay for the public Roseglass MCP reader.
 * Only the host's real delivery bridge can acknowledge images/text; no UI action auto-sends.
 * Caller must disable the old selection listener, and must call onPageChanged on navigation.
 */
export function installReadingSelection({stage, canvas, toolbar, getPageNumber, getDocumentFingerprint,
  onSelectionChanged=()=>{}, onError=console.error, initialMode='point', makeId=()=>globalThis.crypto?.randomUUID?.() || `selection-${Date.now()}`}={}) {
  if (![stage,canvas,toolbar].every(Boolean) || typeof getPageNumber!=='function' || typeof getDocumentFingerprint!=='function' || typeof onSelectionChanged!=='function') throw new TypeError('Missing selection adapter');
  const doc=stage.ownerDocument;
  const selector=doc.createElement('div');
  selector.className='roseglass-reading-selection-tools';
  selector.setAttribute('role','group');selector.setAttribute('aria-label','课件选择范围');
  for(const [action,label] of [['point','● 点选'],['region','＋ 框选'],['page','▣ 整页']]){
    const btn=doc.createElement('button');btn.type='button';btn.dataset.action=action;btn.textContent=label;
    btn.setAttribute('aria-label',action==='page'?'选择当前整页':label);
    selector.appendChild(btn);
  }
  toolbar.appendChild(selector);
  const overlay=doc.createElement('div');
  overlay.className='roseglass-reading-selection-overlay';
  overlay.setAttribute('role','presentation');
  stage.appendChild(overlay);
  const rectangle=doc.createElement('div');rectangle.className='roseglass-reading-selection-rectangle';rectangle.hidden=true;
  overlay.appendChild(rectangle);
  const marker=doc.createElement('div');marker.className='roseglass-reading-selection-mini-pin';marker.hidden=true;
  overlay.appendChild(marker);
  let mode='point', selection=null, drawing=null, disposed=false;
  const page=()=>{
    const n=getPageNumber();
    if(!Number.isSafeInteger(n)||n<1)throw new RangeError('Missing page number');
    return n;
  };
  const documentId=()=>{
    const id=getDocumentFingerprint();
    if(typeof id!=='string' || !id.trim())throw new Error('Stable document fingerprint is required to prevent cross-document selection');
    return id;
  };
  const identity=()=>({pageNumber:page(),documentFingerprint:documentId()});
  const selectionFor=(kind,fields={})=>makeSelection({kind,...identity(),selectionId:makeId(),...fields});
  const current=(s)=>!disposed && selection?.selectionId===s.selectionId &&
    s.pageNumber===page() && s.documentFingerprint===documentId();
  function renderOverlay(){
    marker.hidden=selection?.kind!=='point';rectangle.hidden=selection?.kind!=='region';
    if(selection?.kind==='point'){
      marker.style.left=`${selection.point.x*100}%`;marker.style.top=`${selection.point.y*100}%`;
    }
    if(selection?.kind==='region') drawRect(selection.region);
  }
  function drawRect(r){
    rectangle.style.left=`${r.x*100}%`;rectangle.style.top=`${r.y*100}%`;
    rectangle.style.width=`${r.width*100}%`;rectangle.style.height=`${r.height*100}%`;
  }
  function applySelection(s){if(disposed)throw new Error('Selection controller is disposed');selection=s;renderOverlay();updateButtons();onSelectionChanged(s);}
  function updateButtons(){
    for(const btn of selector.querySelectorAll('button')){
      const active=btn.dataset.action==='page'?selection?.kind==='page':btn.dataset.action===mode;
      btn.setAttribute('aria-pressed',String(active));
    }
    overlay.dataset.mode=mode;
  }
  function setMode(next){
    if(!['point','region'].includes(next))throw new RangeError('Selection mode is point or region');
    if(drawing){drawing=null;rectangle.hidden=true;}
    // Switching modes must never leave an old point/page selection ready to send.
    // A selected page is not a persistent mode: returning to point/region clears it.
    if(mode!==next || (selection && selection.kind!==next)){
      selection=null;renderOverlay();onSelectionChanged(null);
    }
    mode=next;updateButtons();
  }
  const buttonHandlers=[];
  for (const btn of selector.querySelectorAll('button')){
    const handler=()=>{
      if(btn.dataset.action==='page'){
        try{applySelection(selectionFor('page'));}catch(e){onError(e);}
      } else setMode(btn.dataset.action);
    };
    btn.addEventListener('click',handler);buttonHandlers.push([btn,handler]);
  }
  // Stage and canvas may differ in size or have letterbox margins. Bound the overlay to
  // the ACTUAL PDF canvas; CSS page zoom never changes its normalized coordinate space.
  function alignOverlay(){
    if(disposed)return;
    const parent=stage.getBoundingClientRect(), bounds=canvas.getBoundingClientRect();
    if(parent.width===0||parent.height===0||bounds.width===0||bounds.height===0)return;
    overlay.style.left=`${bounds.left-parent.left+stage.scrollLeft}px`;
    overlay.style.top=`${bounds.top-parent.top+stage.scrollTop}px`;
    overlay.style.width=`${bounds.width}px`;
    overlay.style.height=`${bounds.height}px`;
  }
  const ro=typeof ResizeObserver==='function' ? new ResizeObserver(alignOverlay):null;
  ro?.observe(canvas);ro?.observe(stage);
  alignOverlay();
  const localBounds=()=>canvas.getBoundingClientRect();
  function onDown(e){
    if (e.button!==0 || e.isPrimary===false || (e.ctrlKey||e.metaKey||e.altKey)||disposed)return;
    try{
      alignOverlay();
      const bounds=localBounds();
      // Only accept actual page pixels, never the stage/outer Chat frame.
      if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)return;
      const p=pointFromClient(e.clientX,e.clientY,bounds);
      e.preventDefault();e.stopPropagation();
      if(mode==='point'){applySelection(selectionFor('point',{point:p}));return;}
      // Once a new drag starts, no previous selection should remain deliverable.
      if(selection){selection=null;renderOverlay();onSelectionChanged(null);}
      drawing={id:e.pointerId,start:{x:e.clientX,y:e.clientY},bounds,document:identity()};
      rectangle.hidden=false;drawRect({x:p.x,y:p.y,width:0,height:0});
      overlay.setPointerCapture?.(e.pointerId);
    }catch(err){onError(err);}
  }
  function onMove(e){
    if(!drawing||e.pointerId!==drawing.id)return;
    e.preventDefault();
    try{drawRect(regionFromClient(drawing.start,{x:e.clientX,y:e.clientY},drawing.bounds));}catch(err){onError(err);}
  }
  function onUp(e){
    if(!drawing||e.pointerId!==drawing.id)return;
    const d=drawing;drawing=null;
    try{
      // A page or document change during a drag invalidates the gesture.
      const now=identity();
      if(now.pageNumber!==d.document.pageNumber || now.documentFingerprint!==d.document.documentFingerprint){
        throw new Error('Page or document changed during selection; drag again');
      }
      const r=regionFromClient(d.start,{x:e.clientX,y:e.clientY},d.bounds);
      if(validRegion(r)){applySelection(selectionFor('region',{region:r}));}
      else renderOverlay();
    }catch(err){onError(err);renderOverlay();}
    if(overlay.hasPointerCapture?.(e.pointerId))overlay.releasePointerCapture?.(e.pointerId);
  }
  function onCancel(e){drawing=null;renderOverlay();if(overlay.hasPointerCapture?.(e.pointerId))overlay.releasePointerCapture?.(e.pointerId);}
  function stopLegacyClick(e){e.preventDefault();e.stopImmediatePropagation();}
  overlay.addEventListener('pointerdown',onDown);
  overlay.addEventListener('pointermove',onMove);
  overlay.addEventListener('pointerup',onUp);
  overlay.addEventListener('pointercancel',onCancel);
  overlay.addEventListener('click',stopLegacyClick);
  updateButtons();
  if(initialMode!=='point')setMode(initialMode);
  /**
   * attachImage MUST resolve true or {acknowledged:true} ONLY after the existing Chat host
   * confirms upload. A void promise is NOT evidence of attachment. No hidden fallback.
   * awaitPageRendered is optional but should await the host's current PDF.js render task.
   */
  async function createDelivery({fileName, totalPages, getPageText, getRegionText=()=>null,
    getNearbyText=()=>null, attachImage, awaitPageRendered=async()=>{}}={}){
    if(disposed)throw new Error('Selection controller is disposed');
    if(drawing)throw new Error('Finish the current drag before preparing a delivery');
    if(!selection)throw new Error('Select a point, region, or whole page first');
    if(typeof getPageText!=='function')throw new TypeError('getPageText is required');
    const selected=selection;
    const ensureCurrent=()=>{if(!current(selected))throw new Error('Document, page, or selection changed during preparation; select again');};
    ensureCurrent();
    await awaitPageRendered();ensureCurrent();
    const pageText=await getPageText(selected.pageNumber);ensureCurrent();
    const regionText=selected.kind==='region'?await getRegionText(selected):null;ensureCurrent();
    const nearbyText=selected.kind==='point'?await getNearbyText(selected):null;ensureCurrent();
    const images=[], imageDelivery={page:false,region:false};
    if(typeof attachImage==='function'){
      for(const kind of (selected.kind==='region'?['page','region']:['page'])){
        ensureCurrent();
        try{
          const capture=await captureSelectionImage(canvas,kind==='page'?{kind:'page'}:selected);
          ensureCurrent();
          const image={kind,...capture};images.push(image);
          const receipt=await attachImage(image,selected);
          ensureCurrent();
          // Reject a genuine-looking receipt if it names another selection or image kind.
          imageDelivery[kind]=receipt===true || (receipt?.acknowledged===true &&
            (receipt.selectionId===undefined || receipt.selectionId===selected.selectionId) &&
            (receipt.kind===undefined || receipt.kind===kind));
          if(!imageDelivery[kind])onError(new Error(`${kind} image upload has no acknowledged receipt`));
        }catch(err){onError(err);}
      }
    }
    ensureCurrent();
    const requiredKinds=selected.kind==='region'?['page','region']:['page'];
    const imageAttached=requiredKinds.every(kind=>imageDelivery[kind]);
    return {selection:selected,images,imageDelivery,imageAttached,
      message:buildReadingMessage(selected,{fileName,totalPages,pageText,regionText,nearbyText,imageDelivery})};
  }
  function clear(){selection=null;drawing=null;renderOverlay();updateButtons();onSelectionChanged(null);}
  function dispose(){disposed=true;selection=null;drawing=null;ro?.disconnect();
    overlay.removeEventListener('pointerdown',onDown);overlay.removeEventListener('pointermove',onMove);
    overlay.removeEventListener('pointerup',onUp);overlay.removeEventListener('pointercancel',onCancel);
    overlay.removeEventListener('click',stopLegacyClick);
    for(const [btn,handler] of buttonHandlers)btn.removeEventListener('click',handler);
    overlay.remove();selector.remove();
  }
  return {selectPoint:point=>applySelection(selectionFor('point',{point})),setMode,getMode:()=>mode,getSelection:()=>selection,selectWholePage:()=>applySelection(selectionFor('page')),
    clear,onPageChanged:clear,createDelivery,alignOverlay,dispose};
}
