/** Per-document reading position. Stores only a SHA-256 digest prefix and tiny UI settings. */
export const READING_PROGRESS_PREFIX = 'roseglass:v2:position:';
const modes = new Set(['fit-page', 'fit-width', 'custom']);
const MIN_ZOOM = 0.5, MAX_ZOOM = 3;

// Never key progress by a filename, file size, or content; the caller must supply a secure hash.
export function positionKey(fingerprint) {
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{24,64}$/.test(fingerprint)) return null;
  return READING_PROGRESS_PREFIX + fingerprint;
}
export function normalizedPosition(value, pageCount) {
  if (!value || value.v !== 1 || !Number.isInteger(pageCount) || pageCount < 1 ||
      !Number.isInteger(value.page) || value.page < 0 ||
      !modes.has(value.zoomMode) || !Number.isFinite(value.zoom)) return null;
  return {
    v: 1,
    page: Math.min(value.page, pageCount - 1),
    zoomMode: value.zoomMode,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value.zoom))
  };
}
export function loadReadingPosition(storage, fingerprint, pageCount) {
  const key = positionKey(fingerprint);
  if (!key || !storage) return null;
  try { return normalizedPosition(JSON.parse(storage.getItem(key) || 'null'), pageCount); }
  catch { return null; } // Includes unavailable / disabled local storage.
}
export function saveReadingPosition(storage, fingerprint, pageCount, position) {
  const key = positionKey(fingerprint);
  if (!key || !storage) return false;
  const saved = normalizedPosition({v:1,...position}, pageCount);
  if (!saved) return false;
  try { storage.setItem(key, JSON.stringify(saved)); return true; }
  catch { return false; }
}
export function clearReadingPosition(storage, fingerprint) {
  const key = positionKey(fingerprint);
  if (!key || !storage) return false;
  try { storage.removeItem(key); return true; }
  catch { return false; }
}