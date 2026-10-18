"""Produce a single self-contained Worker and MCP UI resource."""
import json
import base64
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
output = pathlib.Path(sys.argv[2])
html = (root / 'worker/ui.html').read_text()
pdf = (root / 'worker/vendor/pdf.min.mjs').read_text()
pdf_worker = (root / 'worker/vendor/pdf.worker.min.mjs').read_text()
bridge = (root / 'worker/bridge.js').read_text()
reader = (root / 'worker/reader.js').read_text()
helpers = [(root / 'worker/reader-settings.mjs').read_text().replace('export const ', 'const ')]
for name in ('reading-progress', 'study-notes', 'visual-packet', 'vision-challenge'):
    helper = (root / 'worker/v7' / (name + '.mjs')).read_text()
    helper = helper.replace("import {positionKey} from './reading-progress.mjs';", '')
    helper = helper.replace('export function ', 'function ').replace('export const ', 'const ')
    helper = helper.replace("import {drawMiniFocusMarker} from '../zoom/reading-focus-marker.mjs';", '')
    helpers.append(helper)
for name in ('reader-geometry', 'reader-frame', 'reading-focus-marker'):
    helper = (root / 'worker/zoom' / (name + '.mjs')).read_text()
    helpers.insert(0, helper.replace('export function ', 'function ').replace('export const ', 'const '))
for name in ('reading-selection-geometry', 'reading-selection'):
    helper = (root / 'worker/zoom' / (name + '.mjs')).read_text()
    helper = '\n'.join(line for line in helper.splitlines() if not line.startswith('import '))
    helpers.append(helper.replace('export function ', 'function ').replace('export async function ', 'async function ').replace('export const ', 'const '))
ocr = (root / 'worker/ocr/recognize.mjs').read_text().replace('export async function ', 'async function ').replace('export function ', 'function ')
for placeholder, asset in [('__OCR_WASM_GZ__','core.wasm.gz'),('__OCR_CHI_GZ__','chi_sim.traineddata.gz'),('__OCR_DEU_GZ__','deu.traineddata.gz')]:
    ocr = ocr.replace(placeholder, base64.b64encode((root / 'worker/ocr' / asset).read_bytes()).decode())
core = (root / 'worker/ocr/core.js').read_text()
reader = core + '\n' + ocr + '\n' + '\n'.join(helpers) + '\n' + reader
reader = reader.replace('__SAMPLE_PDF__', base64.b64encode((root / 'worker/sample.pdf').read_bytes()).decode())
assert html.count('__PDF_JS__') == 1
assert html.count('__PDF_WORKER_JS__') == 1
assert '</script' not in pdf.lower() and '</script' not in pdf_worker.lower()
assert '</script' not in bridge.lower() and '</script' not in reader.lower()
html = html.replace('__PDF_JS__', pdf).replace('__PDF_WORKER_JS__', pdf_worker)
html = html.replace('__BRIDGE_JS__', bridge).replace('__READER_JS__', reader)
source = (root / 'worker/index.js').read_text()
assert source.count('__EMBEDDED_UI_HTML__') == 1
management = (root / 'worker/reader-settings.mjs').read_text() + '\n' + (root / 'worker/management.mjs').read_text()
management = management.replace('export function ', 'function ').replace('export const ', 'const ')
sources = {name: (root / name).read_text() for name in ('worker/reader.js','worker/ui.html','worker/bridge.js','worker/reader-settings.mjs','worker/zoom/reader-geometry.mjs','worker/zoom/reader-frame.mjs','worker/zoom/reading-focus-marker.mjs','worker/zoom/reading-selection.mjs','worker/zoom/reading-selection-geometry.mjs')}
source = source.replace('__MANAGEMENT_JS__', management).replace('__READER_SOURCES__', json.dumps(sources))
output.write_text(source.replace('__EMBEDDED_UI_HTML__', json.dumps(html)))
