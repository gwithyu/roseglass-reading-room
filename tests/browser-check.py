"""Restricted-runner visual test: inline only the repo's own ES modules to bypass blocked localhost requests.
This exercises REAL Chromium layout/canvas/clicks, but is not a production module/CDN/host end-to-end test.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
root=Path(__file__).resolve().parent.parent
html=(root/'index.html').read_text()
css=(root/'src/styles.css').read_text()
modules=['reading-progress.mjs','study-notes.mjs','segment-text.mjs','visual-packet.mjs','chat-image-bridge.mjs','vision-challenge.mjs','app.js']
content=[]
for module in modules:
 s=(root/'src'/module).read_text()
 s=re.sub(r'^import .*?;$','',s,flags=re.M)
 s=re.sub(r'\bexport (?=(?:function|const|async function))','',s)
 content.append(s)
assert '<script type="module" src="./src/app.js"></script>' in html
html=html.replace('<link rel="stylesheet" href="./src/styles.css" />','<style>'+css+'</style>')
html=html.replace('<script type="module" src="./src/app.js"></script>','<script type="module">'+'\n'.join(content)+'</script>')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
 for width,height in [(1440,900),(390,844)]:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1,accept_downloads=True)
  errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
  page.set_content(html,wait_until='load',timeout=20000)
  page.wait_for_timeout(250)
  page.locator('#toggle-vision-test').click()
  page.wait_for_timeout(250)
  snap=page.evaluate('''() => ({
    w: document.querySelector('#vision-canvas').width,
    h: document.querySelector('#vision-canvas').height,
    pixels: [...document.querySelector('#vision-canvas').getContext('2d').getImageData(0,0,1,1).data],
    panelVisible: !document.querySelector('#vision-panel').classList.contains('hidden'),
    slideBox: document.querySelector('#slide-viewport').getBoundingClientRect().toJSON(),
    panelBox: document.querySelector('#vision-panel').getBoundingClientRect().toJSON(),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    status: document.querySelector('#vision-status').textContent
  })''')
  page.screenshot(path=str(root.parent / f'roseglass-v6-{width}.png'),full_page=True)
  print(json.dumps({'viewport':width,'errors':errors,'checks':snap},ensure_ascii=False))
  assert not errors,errors
  assert snap['w']==1600 and snap['h']==900
  assert snap['panelVisible']
  assert snap['pixels']==[250,246,239,255]
  assert not snap['overflowX']
  with page.expect_download(timeout=20000) as info:
   page.locator('#download-vision').click()
  download=info.value
  path=root.parent / f'roseglass-v6-blind-{width}.png'
  download.save_as(path)
  assert path.stat().st_size>10000
  print('downloaded real browser PNG',path.name,path.stat().st_size)
  page.evaluate("""() => {
    window.__relayCalls=[];
    window.openai={
      uploadFile:async(file,options)=>{window.__relayCalls.push({step:'upload',type:file.type,size:file.size,library:options.library});return {fileId:'mock_file_123'};},
      setWidgetState:async s=>{window.__relayCalls.push({step:'state',imageIds:s.imageIds,modelContent:s.modelContent});},
      sendFollowUpMessage:async obj=>{window.__relayCalls.push({step:'followup',prompt:obj.prompt});}
    };
  }""")
  page.locator('#send-vision').click()
  page.wait_for_function("document.querySelector('#vision-status').textContent.includes('已请求 Chat 回复')",timeout=10000)
  calls=page.evaluate('window.__relayCalls')
  assert [c['step'] for c in calls]==['upload','state','followup'],calls
  assert calls[0]['type']=='image/png' and calls[0]['size']>10000
  assert calls[1]['imageIds']==['mock_file_123']
  assert 'PAGE KEY:' not in calls[1]['modelContent']
  assert 'PAGE KEY:' not in calls[2]['prompt']
  assert calls[2]['prompt'].find('四格')>=0
  print('mock-host relay checked:',[c['step'] for c in calls])
  page.close()
 browser.close()