/** Size the scroll frame from the actual PDF aspect ratio, inside its grid track. */
export function pageFrameSize(pageWidth, pageHeight, availableWidth, maxHeight, padding = 12) {
  if (![pageWidth,pageHeight,availableWidth,maxHeight].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(padding) || padding < 0 || availableWidth <= padding * 2 || maxHeight <= padding * 2) {
    throw new RangeError('Invalid PDF frame dimensions');
  }
  const scale = Math.min((availableWidth - padding * 2) / pageWidth,
    (maxHeight - padding * 2) / pageHeight);
  return {width: pageWidth * scale + padding * 2,
    height: pageHeight * scale + padding * 2};
}
