import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,SourceTextModule} from 'node:vm';

async function engine({blocked=false}={}) {
  const core = await readFile(new URL('../worker/ocr/core.js',import.meta.url),'utf8');
  let source=await readFile(new URL('../worker/ocr/recognize.mjs',import.meta.url),'utf8');
  for(const [key,file] of [['__OCR_WASM_GZ__','core.wasm.gz'],['__OCR_CHI_GZ__','chi_sim.traineddata.gz'],['__OCR_DEU_GZ__','deu.traineddata.gz']])
    source=source.replace(key,(await readFile(new URL('../worker/ocr/'+file,import.meta.url))).toString('base64'));
  const globals={console,WebAssembly:blocked?undefined:WebAssembly,DecompressionStream,Blob,Response,URL,
    Uint8Array,TextDecoder,TextEncoder,atob,performance,setTimeout,clearTimeout};
  globals.window=globals;globals.self=globals;
  const context=createContext(globals);
  const module=new SourceTextModule(core+'\n'+source,{context});
  await module.link(()=>{throw Error('Unexpected OCR network import');});await module.evaluate();
  return module.namespace;
}
test('offline WASM OCR reads real Chinese and English raster text, returns confidence and word boxes',async()=>{
  const module=await engine();
  const png=new Uint8Array(await readFile(new URL('./fixtures/ocr-mixed.png',import.meta.url)));
  const result=await module.recognizeOcrPng(png,1400,550);
  assert.equal(result.engine,'tesseract-7-lstm');
  assert.match(result.text.replace(/\s/g,''),/市场价格决定价值/);
  assert.match(result.text,/MARKET PRICE 120 EUR/);
  assert.match(result.text,/50/);assert.match(result.text,/120/);
  assert.ok(result.confidence>50);
  assert.ok(result.blocks.length>5);
  for(const block of result.blocks) {
    assert.ok(block.box.x>=0&&block.box.y>=0);
    assert.ok(block.box.x+block.box.width<=1.001&&block.box.y+block.box.height<=1.001);
  }
});
test('missing WASM fails explicitly rather than producing OCR success',async()=>{
  const module=await engine({blocked:true});
  await assert.rejects(module.recognizeOcrPng(new Uint8Array([1]),10,10),/WebAssembly/);
});

test('offline trilingual model recognizes Chinese, English and German umlauts and sharp s in one raster',async()=>{
  const module=await engine();
  const png=new Uint8Array(await readFile(new URL('./fixtures/ocr-trilingual.png',import.meta.url)));
  const result=await module.recognizeOcrPng(png,1800,700);
  assert.deepEqual(Array.from(result.languages),['deu','eng','chi_sim']);
  assert.match(result.text.replace(/\s/g,''),/市场价格决定价值/);
  assert.match(result.text,/MARKET PRICE 120 EUR/);
  assert.match(result.text,/Größe/);
  assert.match(result.text,/für/);
  assert.match(result.text,/über/);
  assert.match(result.text,/höchster Preis/);
  assert.match(result.text,/Märkte/);
  assert.match(result.text,/äußere Einflüsse/);
});
