import {drawMiniFocusMarker} from '../zoom/reading-focus-marker.mjs';
/** Build a shareable page image entirely in memory. Nothing is uploaded here. */
export function makePageImage(sourceCanvas, focus = null, createCanvas = () => document.createElement('canvas')) {
  const sw = sourceCanvas?.width, sh = sourceCanvas?.height;
  if (!Number.isSafeInteger(sw) || !Number.isSafeInteger(sh) || sw < 1 || sh < 1) throw new Error('当前页图像尚未渲染完成');
  // High enough for slide labels while bounding memory and upload bandwidth.
  const scale = Math.min(1, 2400 / Math.max(sw, sh), Math.sqrt(4_500_000 / (sw * sh)));
  const width = Math.max(1, Math.floor(sw * scale)), height = Math.max(1, Math.floor(sh * scale));
  const output = createCanvas(); output.width = width; output.height = height;
  const ctx = output.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图像导出');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  if (focus && Number.isFinite(focus.x) && Number.isFinite(focus.y) && focus.x >= 0 && focus.x <= 1 && focus.y >= 0 && focus.y <= 1) {
    drawMiniFocusMarker(ctx, width, height, focus);
  }
  return output;
}

export function exportSize(pageWidth,pageHeight){
  if(!(pageWidth>0&&pageHeight>0&&Number.isFinite(pageWidth)&&Number.isFinite(pageHeight)))throw new Error('Invalid page size');
  const scale=Math.min(2400/Math.max(pageWidth,pageHeight),Math.sqrt(4_500_000/(pageWidth*pageHeight)));
  return {width:Math.max(1,Math.floor(pageWidth*scale)),height:Math.max(1,Math.floor(pageHeight*scale)),scale};
}

export function canvasPngBlob(canvas) {
  return new Promise((resolve,reject) => {
    try {
      canvas.toBlob(blob => blob?.type === 'image/png' && blob.size > 0 ? resolve(blob) : reject(new Error('PNG 编码失败')), 'image/png');
    } catch (err) {
      reject(new Error(err?.name === 'SecurityError' ? '课件包含限制导出的跨域图像，请手动截图上传' : '图像导出失败：' + (err?.message || err)));
    }
  });
}

export function samePageSnapshot(snapshot, current) {
  return !!snapshot && !!current && snapshot.fileKey === current.fileKey && snapshot.page === current.page && snapshot.kind === current.kind && snapshot.renderToken === current.renderToken;
}

export function buildVisualPrompt(pageContext, hasImageReference) {
  const banner = hasImageReference
    ? '本次已请求 ChatGPT 接收当前页 PNG 图像引用。请先确认你是否实际看到了图像像素；若只能看到图片 ID 或文字，请明确说看不到图，不得根据文字推断颜色或形状。'
    : '本次尚未向 ChatGPT 附加图像。请明确说明只能依据以下文字回答，不能猜测页面图形。';
  return `${banner}\n\n${pageContext}`;
}
