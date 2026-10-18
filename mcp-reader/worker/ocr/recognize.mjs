/** Offline Tesseract 7 adapter. Assets are embedded at build time; no network or workers. */
export function ocrRuntimeAvailable() {
  return typeof WebAssembly === 'object' && typeof DecompressionStream === 'function';
}
async function inflateOcrAsset(base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
let ocrModulePromise;
async function loadOcrModule() {
  if (!ocrRuntimeAvailable()) throw Error('当前环境不支持本地 OCR 所需的 WebAssembly / gzip 解压。');
  if (!ocrModulePromise) ocrModulePromise = (async () => {
    const wasmBinary = await inflateOcrAsset('__OCR_WASM_GZ__');
    const module = await TesseractCore({wasmBinary, print(){}, printErr(){}});
    for (const [lang, data] of [['chi_sim','__OCR_CHI_GZ__'], ['deu','__OCR_DEU_GZ__']])
      module.FS.writeFile('/'+lang+'.traineddata', await inflateOcrAsset(data));
    return module;
  })().catch(error => { ocrModulePromise = null; throw error; });
  return ocrModulePromise;
}
export async function recognizeOcrPng(bytes, width, height) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 16000000 ||
      !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw Error('OCR 图像无效或超过大小限制。');
  const module = await loadOcrModule();
  const api = new module.TessBaseAPI();
  try {
    const result = api.Init(null, 'deu+chi_sim', 1);
    if (result !== 0) throw Error('中英德 OCR 模型初始化失败。');
    module.FS.writeFile('/input', bytes);
    api.SetImageFile();
    const text = api.GetUTF8Text().slice(0, 500000);
    const confidence = api.MeanTextConf();
    const blocks = api.GetTSVText(0).split('\n').slice(1).flatMap(row => {
      const fields = row.split('\t');
      if (fields[0] !== '5' || fields.length < 12 || !fields[11].trim()) return [];
      const [x,y,w,h,conf] = fields.slice(6,11).map(Number);
      if (![x,y,w,h,conf].every(Number.isFinite) || x < 0 || y < 0 || w < 0 || h < 0) return [];
      return [{text:fields.slice(11).join('\t'), confidence:conf,
        box:{x:x/width,y:y/height,width:w/width,height:h/height}}];
    }).slice(0,10000);
    return {text, confidence, blocks, engine:'tesseract-7-lstm', languages:['deu','eng','chi_sim'], models:['deu','chi_sim']};
  } finally {
    try {api.End();} finally {module.destroy(api);}
    try {module.FS.unlink('/input');} catch {}
  }
}
export async function recognizeOcrCanvas(source) {
  const scale = Math.min(1, 2200/Math.max(source.width,source.height), Math.sqrt(2500000/(source.width*source.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1,Math.round(source.width*scale));
  canvas.height = Math.max(1,Math.round(source.height*scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(source,0,0,canvas.width,canvas.height);
  const blob = await new Promise((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('OCR PNG 导出失败。')),'image/png'));
  return recognizeOcrPng(new Uint8Array(await blob.arrayBuffer()),canvas.width,canvas.height);
}
