/** Pure, host-independent PDF reading geometry. No application bridge dependency. */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export function fitScales(pageWidth, pageHeight, viewportWidth, viewportHeight, padding = 16) {
  for (const n of [pageWidth, pageHeight, viewportWidth, viewportHeight]) {
    if (!Number.isFinite(n) || n <= 0) throw new RangeError('Invalid page/viewport size');
  }
  const width = Math.max(1, viewportWidth - padding * 2);
  const height = Math.max(1, viewportHeight - padding * 2);
  const fitWidth = width / pageWidth;
  const fitPage = Math.min(fitWidth, height / pageHeight);
  return { fitWidth, fitPage };
}
export function getScale(mode, multiplier, pageWidth, pageHeight, viewportWidth, viewportHeight, padding = 16) {
  const fits = fitScales(pageWidth, pageHeight, viewportWidth, viewportHeight, padding);
  if (mode === 'fit-width') return fits.fitWidth;
  if (mode === 'fit-page') return fits.fitPage;
  if (mode === 'custom') return fits.fitPage * clamp(multiplier, .5, 4);
  throw new RangeError('Unknown zoom mode');
}
export function renderRatio(cssWidth, cssHeight, desiredDpr = 2, pixelBudget = 16000000) {
  if (![cssWidth, cssHeight, pixelBudget].every(v => Number.isFinite(v) && v > 0)) throw new RangeError('Invalid dimensions');
  return Math.min(Math.max(1, desiredDpr), 3, Math.sqrt(pixelBudget / (cssWidth * cssHeight)));
}
export function clientToPagePoint(clientX, clientY, rect) {
  if (!(rect.width > 0 && rect.height > 0)) throw new RangeError('Empty page bounds');
  return { x: clamp((clientX - rect.left) / rect.width, 0, 1), y: clamp((clientY - rect.top) / rect.height, 0, 1) };
}
export function viewportCenterFraction({scrollLeft, scrollTop, clientWidth, clientHeight}, stageRect, viewportRect) {
  // Bounding rect already includes scrolling, so do not add scrollLeft/scrollTop again.
  return { x: clamp((viewportRect.left + clientWidth / 2 - stageRect.left) / stageRect.width, 0, 1),
           y: clamp((viewportRect.top + clientHeight / 2 - stageRect.top) / stageRect.height, 0, 1) };
}
export function desiredScrollToCenter(anchor, stageOffsetLeft, stageOffsetTop, stageWidth, stageHeight, viewportWidth, viewportHeight) {
  return { left: Math.max(0, stageOffsetLeft + anchor.x * stageWidth - viewportWidth / 2),
           top: Math.max(0, stageOffsetTop + anchor.y * stageHeight - viewportHeight / 2) };
}
