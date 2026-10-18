/** Coordinate and delivery helpers. No ChatGPT or Site credentials. */
import { clamp } from './reader-geometry.mjs';
export const SELECTION_MODES = Object.freeze(['point', 'region']);
const finite = (...values) => values.every(Number.isFinite);
export function assertBounds(bounds) {
  if (!bounds || !finite(bounds.left, bounds.top, bounds.width, bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
    throw new RangeError('Invalid rendered PDF page bounds');
  }
  return bounds;
}
export function pointFromClient(x, y, bounds) {
  assertBounds(bounds);
  if (!finite(x, y)) throw new TypeError('Non-finite pointer coordinates');
  return {x: clamp((x - bounds.left) / bounds.width, 0, 1), y: clamp((y - bounds.top) / bounds.height, 0, 1)};
}
export function regionFromClient(start, end, bounds) {
  const a = pointFromClient(start.x, start.y, bounds);
  const b = pointFromClient(end.x, end.y, bounds);
  return {x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(b.x-a.x), height: Math.abs(b.y-a.y)};
}
export function validRegion(rect, minFraction = .006) {
  return !!rect && finite(rect.x,rect.y,rect.width,rect.height) && rect.x >= 0 && rect.y >= 0 && rect.width >= minFraction && rect.height >= minFraction && rect.x + rect.width <= 1.0000001 && rect.y + rect.height <= 1.0000001;
}
export function normalizedRegionToPixels(region, pixelWidth, pixelHeight) {
  if (!validRegion(region, 0) || !finite(pixelWidth,pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) throw new RangeError('Invalid region or image dimensions');
  const left = Math.max(0, Math.min(pixelWidth-1, Math.floor(region.x*pixelWidth)));
  const top = Math.max(0, Math.min(pixelHeight-1, Math.floor(region.y*pixelHeight)));
  const right = Math.max(left+1, Math.min(pixelWidth, Math.ceil((region.x+region.width)*pixelWidth)));
  const bottom = Math.max(top+1, Math.min(pixelHeight, Math.ceil((region.y+region.height)*pixelHeight)));
  return {x:left,y:top,width:right-left,height:bottom-top};
}
function assertPage(page) { if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Invalid page number'); }
export function makeSelection({kind, pageNumber, point, region, selectionId, documentFingerprint=null}) {
  assertPage(pageNumber);
  if (!['point','region','page'].includes(kind)) throw new TypeError('Unknown selection kind');
  if (kind === 'point' && (!point || !finite(point.x,point.y) || point.x<0 || point.x>1 || point.y<0 || point.y>1)) throw new RangeError('Invalid point');
  if (kind === 'region' && !validRegion(region)) throw new RangeError('Invalid region');
  if (typeof selectionId !== 'string' || !selectionId) throw new TypeError('Missing selection id');
  return Object.freeze({schema:'gmind-reading-selection/v1', kind, pageNumber, selectionId, documentFingerprint,
    ...(kind === 'point' ? {point:{x:point.x,y:point.y}} : {}),
    ...(kind === 'region' ? {region:{...region}} : {})});
}
/** The page is always the context, never just nearby text. The region image is additional context. */
export function buildReadingMessage(selection, {fileName='课件', totalPages, pageText='', regionText=null, nearbyText=null, imageAttached=false, imageDelivery=null}={}) {
  if (selection?.schema !== 'gmind-reading-selection/v1') throw new TypeError('Expected selection v1');
  const scope = {point:'点选（聚焦该位置并结合整页解释）',region:'框选（重点解释选框，并结合整页上下文）',page:'整页（完整讲解整页）'}[selection.kind];
  const head = [`请继续与我共读。`, `课件：${fileName}`, `当前页：${selection.pageNumber}${Number.isSafeInteger(totalPages)?` / ${totalPages}`:''}`, `范围：${scope}`, `选择记录：${JSON.stringify(selection)}`];
  if (selection.kind==='region' && typeof regionText === 'string') head.push(`框选区提取文字：\n${regionText}`);
  if (selection.kind==='point' && typeof nearbyText === 'string') head.push(`点击附近文字（仅作辅助，不能替代整页）：\n${nearbyText}`);
  head.push(`当前页完整文字（必须包含，不能只发送选区附近的片段）：\n${pageText}`);
  const uploadedPage = imageDelivery ? imageDelivery.page === true : imageAttached === true;
  const uploadedRegion = imageDelivery ? imageDelivery.region === true : imageAttached === true;
  if (selection.kind === 'region') {
    head.push(`图像上传回执：整页${uploadedPage ? '已确认' : '未确认'}；选区${uploadedRegion ? '已确认' : '未确认'}。`);
  } else head.push(uploadedPage ? '当前页图像上传已确认。' : '当前页图像上传尚未确认。');
  head.push('只根据当前聊天实际收到的图像讨论视觉细节；没有收到图像时必须明确说明，不能由上传回执或文字猜测图像。');
  return head.join('\n\n');
}
/** Canvas is already rendered by existing PDF.js host at effective DPR. Crop copies pixels, not CSS screenshot. */
export async function captureSelectionImage(canvas, selection, {createCanvas, mimeType='image/png'}={}) {
  if (!canvas || !finite(canvas.width,canvas.height) || canvas.width<1 || canvas.height<1) throw new RangeError('Source canvas unavailable');
  if (!createCanvas && typeof document==='undefined') throw new Error('A canvas factory is needed without browser DOM');
  const pixels = selection?.kind === 'region'
    ? normalizedRegionToPixels(selection.region,canvas.width,canvas.height)
    : {x:0,y:0,width:canvas.width,height:canvas.height};
  const output = createCanvas ? createCanvas(pixels.width,pixels.height) : document.createElement('canvas');
  output.width=pixels.width;output.height=pixels.height;
  const ctx=output.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(canvas,pixels.x,pixels.y,pixels.width,pixels.height,0,0,pixels.width,pixels.height);
  const blob = await new Promise((resolve,reject)=>{
    if(typeof output.toBlob !== 'function') { reject(new Error('toBlob unavailable')); return; }
    output.toBlob(b=>b?resolve(b):reject(new Error('Canvas PNG export failed')),mimeType);
  });
  return {blob, sourceRect:pixels, mimeType};
}
