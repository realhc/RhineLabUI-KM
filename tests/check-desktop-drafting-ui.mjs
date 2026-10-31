import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const run=resolve("release/document-images-test/drafting"), evidence=resolve("verification/drafting");
const portable=join(run,"portable");
await mkdir(run,{recursive:true}); await mkdir(evidence,{recursive:true});
await cp(resolve("release/packages/RhineLab-win32-x64"),portable,{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>part.toLowerCase()==="rhinelabdata")});
let app,page;const errors=[],checks={};
async function poll(fn,arg){const end=Date.now()+60000;do{if(await page.evaluate(fn,arg))return;await page.waitForTimeout(80);}while(Date.now()<end);throw Error("Drafting state timeout: "+fn);}
async function open(doc){await page.locator('[data-view="all"]').click();await page.locator('#search').fill(doc.title);await page.locator(`#documents [data-id="${doc.id}"]`).click();await poll(title=>document.querySelector('#title')?.value===title,doc.title);}
async function geometry(){return page.evaluate(()=>{
 const root=document.querySelector('#preview'),heading=root.querySelector('.tiptap h1'),sheet=root.querySelector('#document-drafting'),guide=sheet?.querySelector('[data-draft-heading="H1"]');
 if(!heading||!guide)return null;
 const range=document.createRange();range.selectNodeContents(heading);const rect=range.getBoundingClientRect(),area=root.getBoundingClientRect();
 return {dx:Math.abs(Number(guide.dataset.textX)-(rect.left-area.left)),dy:Math.abs(Number(guide.dataset.textY)-(rect.top-area.top)),outsideEditor:!root.querySelector('.tiptap').contains(sheet),pointerEvents:getComputedStyle(sheet).pointerEvents,width:root.clientWidth,scrollWidth:root.scrollWidth,labelsHidden:getComputedStyle(guide.querySelector('.draft-size')).display==='none'};
});}
async function waitGeometry(){await poll(()=>!!document.querySelector('#document-drafting [data-draft-heading="H1"]'));await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(100);const value=await geometry();assert(value&&value.dx<1&&value.dy<1,JSON.stringify(value));assert(value.outsideEditor);assert.equal(value.pointerEvents,'none');assert(value.scrollWidth<=value.width+1);return value;}
async function theme(value){await page.locator('#library-close').click();await page.locator('[data-action="settings"]').click();await page.locator(`[data-color-theme="${value}"]`).click();await page.locator('[data-action="close-modal"]').click();await page.locator('[data-action="search"]').click();await poll(()=>document.querySelector('#library-overlay')?.dataset.motionState==='open');}

try{
 app=await electron.launch({executablePath:join(portable,'RhineLab.exe'),args:['--user-data-dir='+join(run,'profile')],timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));await poll(()=>window.rhineReview?.stats().ready);await page.locator('.entry-start').click();await poll(()=>window.rhineReview.stats().startup==='started');await page.evaluate(()=>window.rhineReview.archive());await page.locator('[data-action="search"]').click();await poll(()=>document.querySelector('#library-overlay')?.dataset.motionState==='open');
 const docs=await page.evaluate(async()=>{
  const category=await window.rhine.createCategory('构造与尺度');const make=(title,body)=>window.rhine.create({title,body,categoryId:category.id,category:category.name});
  const target=await make('结构与连接','## 节点与关系\n\n每条连接对应一份资料的引用。\n');
  const body='# 从尺度开始\n\n网格定义留白，文字保持自己的节奏。标题的定位角依照实际文字位置绘制，细线退到阅读之后。\n\n## 01 结构与比例\n\n用直线组织信息，用留白区分层级。局部框架标示文字的宽度与字号，正文不需要被强制挤进等高的格子。\n\n[结构与连接]('+target.id+'.md)\n\n> 线条提供坐标，内容决定重心。\n\n| 单元 | 尺度 |\n| --- | --- |\n| 细格 | 24 |\n| 主格 | 96 |\n\n```typescript\nconst rhythm = { unit: 24, major: 96 };\n```\n\n## 长标题在较窄的阅读区域中也应保持自然换行与准确的定位关系\n\n文字、表格与公式保留原有阅读方式。\n\n$E=mc^2$\n';
  const source=await make('构造笔记',body);
  for(const title of ['空间秩序','材料与光','边界条件','观察日志','档案索引'])await make(title,'[构造笔记]('+source.id+'.md)\n');
  return {source,target,body};
 });
 await open(docs.source);checks.lightGeometry=await waitGeometry();await page.screenshot({path:join(evidence,'document-light.png')});
 await page.keyboard.press('e');await page.keyboard.press('Control+s');assert.equal((await page.evaluate(id=>window.rhine.read(id),docs.source.id)).body,docs.body);checks.untouchedMarkdownPreserved=true;
 const before=await page.locator('#preview .tiptap').innerText();await page.locator('#preview .tiptap').press('Control+End');await page.keyboard.insertText('尺寸验证');await page.waitForTimeout(250);await page.keyboard.press('Control+z');assert.equal(await page.locator('#preview .tiptap').innerText(),before);checks.undoIgnoresDecoration=true;await page.keyboard.press('Control+s');
 await open(docs.target);await open(docs.source);checks.rebuiltEditorGeometry=await waitGeometry();
 // Let the repository watcher finish its post-save refresh before measuring idle redraws.
 await page.waitForTimeout(600);
 await page.evaluate(()=>{window.draftMutations=0;window.draftObserver=new MutationObserver(()=>window.draftMutations++);window.draftObserver.observe(document.querySelector('#document-drafting'),{childList:true,attributes:true,subtree:true});});await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>{window.draftObserver.disconnect();return window.draftMutations;}),0);checks.noIdleRedraw=true;
 await page.locator('#graph-open').click();await poll(()=>document.querySelector('#graph-workspace')?.open);
 assert.equal(await page.locator('#graph-canvas .graph-grid').evaluate(element=>getComputedStyle(element).pointerEvents),'none');
 const pattern=page.locator('#graph-grid-minor'),beforeScale=await pattern.getAttribute('width');await page.locator('#graph-canvas').hover({position:{x:300,y:240}});await page.mouse.wheel(0,-400);await poll(value=>document.querySelector('#graph-grid-minor')?.getAttribute('width')!==value,beforeScale);
 await page.locator('#graph-fit').click();await page.mouse.move(8,8);await page.screenshot({path:join(evidence,'graph-light.png')});
 await page.locator(`[data-graph-id="${docs.target.id}"]`).click();await poll(title=>document.querySelector('#title')?.value===title&&!document.querySelector('#graph-workspace')?.open,docs.target.title);checks.gridDoesNotBlockNodes=true;
 await open(docs.source);await theme('dark');await open(docs.source);checks.darkGeometry=await waitGeometry();await page.screenshot({path:join(evidence,'document-dark.png')});
 await page.locator('#graph-open').click();await poll(()=>document.querySelector('#graph-workspace')?.open);await page.screenshot({path:join(evidence,'graph-dark.png')});await page.locator('#graph-close').click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,680));await page.waitForTimeout(200);checks.narrowGeometry=await waitGeometry();assert(checks.narrowGeometry.labelsHidden);await page.screenshot({path:join(evidence,'document-narrow.png')});
 assert.deepEqual(errors,[]);await writeFile(join(evidence,'result.json'),JSON.stringify({checks,errors},null,2));console.log('Drafting: measured alignment, light/dark/narrow views, clean Markdown, undo, editor replacement, idle redraw and graph hit targets passed.');
}catch(error){await page?.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});await writeFile(join(evidence,'failure.json'),JSON.stringify({checks,errors,error:String(error),stack:error.stack},null,2));throw error;}finally{await app?.close();}
