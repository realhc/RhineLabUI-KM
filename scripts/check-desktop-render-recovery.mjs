import { _electron as electron } from 'playwright';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('verification/client-repair');
const run=resolve('release/render-recovery',String(Date.now()));
const portable=join(run,'portable');
await mkdir(out,{recursive:true});
await cp(resolve('release/packages/RhineLab-win32-x64'),portable,{recursive:true,filter:p=>!p.split(/[\\/]/).includes('RhineLabData')});
let app;
const errors=[],checks={},layouts=[];
try {
  app=await electron.launch({executablePath:join(portable,'RhineLab.exe'),args:['--user-data-dir='+join(run,'profile')],timeout:60000});
  const p=await app.firstWindow();
  p.on('pageerror',e=>errors.push(e.message));
  async function poll(fn,arg,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await p.evaluate(fn,arg))return;await p.waitForTimeout(80);}throw Error('Recovery check timed out: '+fn);}
  await poll(()=>window.rhineReview?.stats().ready);
  await p.locator('.entry-start').click();
  await poll(()=>window.rhineReview.stats().startup==='started');
  await p.locator('#skip').click();
  await p.waitForTimeout(3500);
  const before=await p.evaluate(()=>window.rhineReview.stats());
  assert(before.archiveCount>100);assert(before.renderedFrames>0);
  assert.equal(await p.locator('#library-overlay').count(),0,'Rich editor is not constructed during scene startup');
  checks.editorLoadsOnDemand=true;
  await p.evaluate(()=>{window.inspectionChanges=0;window.inspectionObserver=new MutationObserver(m=>window.inspectionChanges+=m.length);window.inspectionObserver.observe(document.querySelector('#inspection-marks'),{subtree:true,childList:true,attributes:true});});
  await p.waitForTimeout(1000);
  const mutations=await p.evaluate(()=>{window.inspectionObserver.disconnect();return window.inspectionChanges;});
  assert.equal(mutations,0,'Invisible scan overlay performs no DOM writes');
  checks.invisibleScan={mutations,skippedFrames:(await p.evaluate(()=>window.rhineReview.stats())).renderHealth.inspectionSkippedFrames};
  // Inject a transient DOM fault during the actual RAF update; the next frame must still run.
  await p.evaluate(()=>{const style=document.querySelector('#stage').style;const original=style.setProperty.bind(style);style.setProperty=(name,...args)=>{if(name==='--detail-shade'){style.setProperty=original;throw Error('Injected one-frame DOM fault');}return original(name,...args);};window.rhineReview.detail();});
  await poll(()=>window.rhineReview.stats().renderHealth.frameErrors===1);
  const interrupted=await p.evaluate(()=>window.rhineReview.stats().renderedFrames);
  await poll(n=>window.rhineReview.stats().renderedFrames>n+5,interrupted);
  checks.transientFrameRecovers=true;
  await p.evaluate(()=>window.rhineReview.archive());
  await p.waitForTimeout(1800);
  await p.evaluate(()=>{const c=document.querySelector('#three-scene canvas');window.originalCanvas=c;window.lostContext=c.getContext('webgl2').getExtension('WEBGL_lose_context');if(!window.lostContext)throw Error('Context-loss extension unavailable');window.lostContext.loseContext();});
  await poll(()=>window.rhineReview.stats().renderHealth.graphicsLost);
  assert(await p.locator('.graphics-status').isVisible());
  await p.evaluate(()=>window.lostContext.restoreContext());
  await poll(()=>!window.rhineReview.stats().renderHealth.graphicsLost);
  await p.waitForTimeout(1500);
  assert(await p.evaluate(()=>window.originalCanvas===document.querySelector('#three-scene canvas')));
  const restored=await p.evaluate(()=>window.rhineReview.stats());assert(restored.archiveCount>100);assert(restored.drawCalls>40);
  checks.contextRestoredWithoutReload=true;
  // Leave GPU loss unresolved while a draft is open. Rebuild only graphics, retain editor state.
  await p.locator('[data-action=search]').click();
  await p.locator('.document').first().click();
  await p.locator('#save').click();
  const draft='Recovery draft must remain';
  await p.locator('#preview .tiptap').fill(draft);
  const id=await p.locator('.document.selected').getAttribute('data-id');
  await p.evaluate(()=>{window.originalCanvas=document.querySelector('#three-scene canvas');window.originalCanvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();});
  await poll(()=>window.rhineReview.stats().renderHealth.graphicsRecoveries===1&&!window.rhineReview.stats().renderHealth.recoveringGraphics);
  assert(await p.evaluate(()=>window.originalCanvas!==document.querySelector('#three-scene canvas')));
  assert((await p.locator('#preview .tiptap').innerText()).includes(draft));
  assert.equal(await p.locator('.document.selected').getAttribute('data-id'),id);
  checks.unrestoredContextRebuildKeepsDraft=true;
  await p.locator('#save').click();
  await poll(()=>document.querySelector('#state').textContent.includes('已保存'));
  await p.locator('#library-close').click();
  await p.waitForTimeout(1800);
  const rebuilt=await p.evaluate(()=>window.rhineReview.stats());assert(rebuilt.archiveCount>100);assert(rebuilt.drawCalls>40);assert.equal(rebuilt.renderHealth.graphicsLost,false);
  await p.screenshot({path:join(out,'array-after-recovery.png')});
  for(const [width,height] of [[1000,680],[1440,900],[1920,1080]]) {
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(...size),[width,height]);
    await p.waitForTimeout(1000);
    const stats=await p.evaluate(()=>window.rhineReview.stats());assert(stats.archiveCount>100);assert(stats.drawCalls>40);
    await p.locator('[data-action=search]').click();
    await p.locator('.document').first().click();await p.locator('#save').click();
    const layout=await p.evaluate(()=>{const controls=document.querySelector('.library-controls').getBoundingClientRect();const panes=document.querySelector('#panes').getBoundingClientRect();const aside=document.querySelector('#library-overlay aside');const spine=getComputedStyle(aside,'::before');const axis=aside.getBoundingClientRect().left+parseFloat(spine.left)+parseFloat(spine.width)/2;const tickOffsets=[...document.querySelectorAll('.category-tick,.document')].map(e=>e.getBoundingClientRect().left+parseFloat(getComputedStyle(e,'::before').left)-axis);return {axis,tickOffsets,controlsBottom:controls.bottom,panesTop:panes.top,scrollWidth:document.documentElement.scrollWidth,innerWidth,tools:[...document.querySelectorAll('#format button,#format select')].filter(e=>e.offsetWidth&&e.offsetHeight).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})};});
    assert(layout.controlsBottom<=layout.panesTop+1,'Controls overlap document at '+width);
    assert(layout.scrollWidth<=layout.innerWidth,'Horizontal overflow at '+width);
    assert(layout.tools.every(r=>r.x>=0&&r.right<=width&&r.bottom<=layout.panesTop+1),'Toolbar outside controls');
    assert(layout.tickOffsets.every(offset=>Math.abs(offset)<0.55),'Major/minor ticks disconnected from axis');
    layouts.push({width,height,...layout});
    await p.waitForTimeout(500);
    await p.screenshot({path:join(out,'library-'+width+'.png')});
    await p.locator('#library-close').click();
  }
  checks.resizeAndToolbar=true;
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
  await p.waitForTimeout(800);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
  await p.waitForTimeout(1000);
  assert((await p.evaluate(()=>window.rhineReview.stats())).archiveCount>100);
  checks.minimizeRestore=true;
  // Repeated real entry/skip paths, including a GPU loss before the first scene frame.
  for(let cycle=0;cycle<3;cycle++) {
    if(cycle===2) await p.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('rhine-settings'));prefs.sound=false;prefs.music=false;localStorage.setItem('rhine-settings',JSON.stringify(prefs));});
    if(cycle===0) await p.route('**/archive-cassette.*.glb',async route=>{await new Promise(r=>setTimeout(r,3000));await route.continue();});
    await p.reload();
    if(cycle===0) {
      await poll(()=>!!document.querySelector('#three-scene canvas'));
      await p.evaluate(()=>document.querySelector('#three-scene canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    }
    await poll(()=>window.rhineReview?.stats().ready);
    if(cycle===0) await p.unroute('**/archive-cassette.*.glb');
    if(await p.locator('.entry-start').count()) await p.locator('.entry-start').click();
    await poll(()=>window.rhineReview.stats().startup==='started');
    await p.locator('#skip').click();
    await poll(()=>{const s=window.rhineReview.stats();return s.mode==='archive'&&s.archiveCount>100&&s.renderedFrames>10&&!s.renderHealth.graphicsLost&&!s.renderHealth.recoveringGraphics;});
  }
  checks.startupAndSkipRepeatedWithEarlyGpuLoss=true;
  await p.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('rhine-settings'));prefs.colorTheme='dark';localStorage.setItem('rhine-settings',JSON.stringify(prefs));});
  await p.reload();await poll(()=>window.rhineReview?.stats().ready);
  await p.locator('#skip').click();await p.waitForTimeout(2000);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
  await p.locator('[data-action=search]').click();await p.locator('.document').first().click();await p.locator('#save').click();await p.waitForTimeout(500);
  const darkControls=await p.evaluate(()=>{const el=document.querySelector('.library-controls');const s=getComputedStyle(el);const buttons=[...el.querySelectorAll('.header-actions button,.toolbar button,#format button')].filter(e=>e.offsetWidth);return {background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,buttonShadows:buttons.map(e=>getComputedStyle(e).boxShadow)};});
  assert.equal(darkControls.background,'rgba(0, 0, 0, 0)');assert.equal(darkControls.border,'0px');assert.equal(darkControls.shadow,'none');assert(darkControls.buttonShadows.every(s=>s==='none'));
  checks.darkTransparentControls=true;
  await p.screenshot({path:join(out,'library-dark.png')});
  assert.deepEqual(errors,[]);
  await writeFile(join(out,'recovery-result.json'),JSON.stringify({checks,errors,layouts,darkControls,before,restored,rebuilt},null,2)+'\n');
  console.log(JSON.stringify({checks,errors},null,2));
} finally {
  await app?.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});
  await app?.close().catch(()=>{});
}
