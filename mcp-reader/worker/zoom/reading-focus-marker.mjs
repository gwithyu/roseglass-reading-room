/**
 * Small, scale-aware focus point for exported/current-page PNGs.
 * This draws ONLY a discreet marker; it does not read files or send anything.
 * Replace the old oversized-ring/crosshair drawing (do not draw both).
 */
export function miniMarkerGeometry(width, height, focus) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Invalid page image dimensions');
  }
  if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.y) ||
      focus.x < 0 || focus.x > 1 || focus.y < 0 || focus.y > 1) return null;
  // About 8px across on an 817px-wide transmitted preview, not the old ~40px target.
  const radius = Math.max(3, Math.min(10, width * 0.0048));
  return {x: Math.round(focus.x * width), y: Math.round(focus.y * height), radius};
}

export function drawMiniFocusMarker(ctx, width, height, focus) {
  const dot = miniMarkerGeometry(width, height, focus);
  if (!dot) return false;
  const {x, y, radius} = dot;
  ctx.save();
  // Light white separation from dark labels, then a small rose-brown center.
  ctx.beginPath();
  ctx.arc(x, y, radius + 1.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#a26069';
  ctx.fill();
  ctx.restore();
  return true;
}
