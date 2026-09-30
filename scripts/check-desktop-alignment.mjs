import {_electron as electron} from 'playwright';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('verification/desktop-alignment');const run=resolve('release/alignment-test',Date.now().toString());await mkdir(run,{recursive:true});
const portable=join(run,'portable');await cp(resolve('release/packages/RhineLab-win32-x64'),portable,{recursive:true});
const app=await electron.launch({executablePath:join(portable,'RhineLab.exe'),args:['--user-data-dir='+join(run,'profile')],timeout:60000});
const page=await app.firstWindow();const errors=[],failed=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()]);});page.on('request',r=>requests.push(r.url()));
const docs=()=>page.evaluate(()=>window.rhine.list());
try {
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));
 await page.waitForFunction(()=>window.rhineReview?.stats().ready,null,{timeout:60000});
 assert.equal(await page.locator('#library-overlay').isVisible(),false);
 await page.locator('.entry-start').click();await page.waitForFunction(()=>window.rhineReview.stats().startup==='started');
 await page.evaluate(()=>window.rhineReview.archive());await page.waitForTimeout(2400);
 const geometry=await page.evaluate(()=>Object.fromEntries(['.brand','.system-nav','.archive-callout','.archive-navigation','.column-navigation','.system-footer','#three-scene'].map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),s=getComputedStyle(el);return [selector,{x:r.x,y:r.y,width:r.width,height:r.height,font:s.fontFamily,color:s.color}]})));
 const reference=JSON.parse(await readFile(join(out,'web-reference.json'),'utf8'));
 for(const [selector,box] of Object.entries(geometry))for(const key of ['x','y','width','height'])assert.ok(Math.abs(box[key]-reference.geometry[selector][key])<.5,selector+' '+key+': '+box[key]+' vs '+reference.geometry[selector][key]);
 await page.screenshot({path:join(out,'desktop-archive.png')});
 await page.evaluate(()=>window.rhineReview.detail());await page.waitForTimeout(3200);await page.screenshot({path:join(out,'desktop-detail.png')});
 assert.equal(await page.locator('#detail-content .detail-title-cn').innerText(),'莱茵生命\n机构档案');
 await page.locator('[data-action="edit-local"]').click();await page.waitForFunction(()=>document.querySelector('#library-overlay').open);
 assert.equal(await page.locator('#title').inputValue(),'莱茵生命');
 await page.keyboard.press('Control+n');await page.waitForFunction(()=>document.querySelectorAll('#documents .document').length===41);
 await page.locator('#title').fill('Visual alignment document');await page.locator('#preview .tiptap').fill('# Local Markdown\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<script>window.unsafe=true</script>\n\nAlignmentNeedle');await page.locator('#save').click();
 await page.waitForFunction(()=>document.querySelector('#state').textContent.includes('已保存'));
 const created=(await docs()).documents.find(d=>d.title==='Visual alignment document');assert.ok(created);assert.equal(await page.evaluate(()=>window.unsafe),undefined);
 const before=await page.evaluate(()=>window.rhineReview.stats().selected);await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.rhineReview.stats().selected),before);
 await page.screenshot({path:join(out,'desktop-editor.png')});
 await page.locator('#library-close').click();await page.waitForFunction(()=>!document.querySelector('#library-overlay').open);
 assert.equal(await page.evaluate(()=>window.rhineReview.stats().selected),created.id);
 await page.locator('[data-action="open"]').first().click();await page.waitForTimeout(2000);assert.match(await page.locator('#tab-panel').innerText(),/AlignmentNeedle/);
 await page.keyboard.press('Escape');await page.locator('[data-action="search"]').click();await page.locator('#search').fill('AlignmentNeedle');assert.equal(await page.locator('#documents .document').count(),1);await page.locator('#documents .document').click();
 await page.locator('#save').click();await page.locator('#preview .tiptap').fill('Unsaved');await page.locator('#library-close').click();await page.locator('[data-choice="cancel"]').click();assert.equal((await page.locator('#preview .tiptap').innerText()).trim(),'Unsaved');
 await page.locator('#library-close').click();await page.locator('[data-choice="discard"]').click();await page.waitForFunction(()=>!document.querySelector('#library-overlay').open);
 await page.locator('[data-action="settings"]').click();assert.equal(await page.locator('[data-pwa-action="install"]').count(),0);await page.locator('[data-color-theme="dark"]').click();await page.waitForTimeout(1000);await page.locator('[data-action="close-modal"]').click();await page.waitForTimeout(300);
 await page.locator('[data-action="search"]').click();await page.locator('#search').fill('Visual alignment document');await page.locator('#documents .document').click();await page.locator('#remove').click();await page.locator('[data-choice="delete"]').click();await page.waitForFunction(()=>!document.querySelector('#editor').offsetHeight);
 await page.locator('[data-view="trash"]').click();await page.locator('#documents .document').click();await page.locator('#restore').click();await page.waitForFunction(()=>document.querySelectorAll('#documents .document').length===41);
 await page.locator('#library-close').click();await page.waitForFunction(()=>!document.querySelector('#library-overlay').open);
 assert.equal(await page.evaluate(()=>typeof window.require),'undefined');assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.equal(requests.filter(url=>/^https?:/.test(url)).length,0);
 const result={geometry,matchingWebLayout:true,sharedOriginalScene:true,createSaveRead:true,fulltext:true,unsavedCancelDiscard:true,trashRestore:true,keyboardIsolation:true,nodeIsolation:true,offline:true,errors,failed,stats:await page.evaluate(()=>window.rhineReview.stats())};
 await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(e) { await page.screenshot({path:join(out,'failure.png')}).catch(()=>{});console.error('ERRORS',errors,'FAILED',failed);console.error(await page.locator('body').innerText());throw e; }
finally { await app.close(); }


const again=await electron.launch({executablePath:join(portable,'RhineLab.exe'),args:['--user-data-dir='+join(run,'profile')],timeout:60000});
try {
 const p=await again.firstWindow();const faults=[];p.on('pageerror',e=>faults.push(e.message));
 await p.waitForFunction(()=>window.rhineReview?.stats().ready,null,{timeout:60000});
 const persisted=await p.evaluate(()=>window.rhine.list());assert.equal(persisted.documents.length,41);assert.ok(persisted.documents.some(d=>d.body.includes('AlignmentNeedle')));
 await p.locator('.entry-start').click();await p.waitForFunction(()=>window.rhineReview.stats().startup==='started');await p.evaluate(()=>window.rhineReview.archive());
 await again.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,680));
 await p.locator('[data-action="search"]').click();await p.waitForFunction(()=>document.querySelector('#library-overlay').open);await p.screenshot({path:join(out,'desktop-small.png')});await p.locator('#library-close').click();
 await p.evaluate(async()=>{const result=await window.rhine.list();for(const doc of result.documents)await window.rhine.trash(doc.id,doc.revision);});
 await p.waitForTimeout(700);await p.locator('[data-action="search"]').click();await p.waitForFunction(()=>document.querySelectorAll('#documents .document').length===0);await p.screenshot({path:join(out,'desktop-empty.png')});
 await p.keyboard.press('Control+n');await p.waitForFunction(()=>document.querySelectorAll('#documents .document').length===1);await p.locator('#library-close').click();await p.waitForTimeout(500);assert.equal(await p.evaluate(()=>window.rhineReview.stats().ready),true);assert.deepEqual(faults,[]);
 const result=JSON.parse(await readFile(join(out,'result.json'),'utf8'));Object.assign(result,{restartPersistence:true,smallWindow:true,emptyLibrary:true,singleDocument:true});await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log('Restart, small window, empty library and single document passed.');
}finally{await again.close();}
