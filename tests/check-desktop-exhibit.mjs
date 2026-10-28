import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {records, setDesktopDocuments, columnFiles, fileLocation, exhibitDocument, documentForRecord, displayCode} from '../src/desktop-data.ts';
const content=JSON.parse(readFileSync('content/archives.json','utf8'));
function sampleDoc(s,index) {
 const metadata=[['英文名称',s.en],['部门',s.department],['档案日期',s.date],['负责人',s.lead],['访问级别',s.clearance]].filter(([,v])=>v).map(([l,v])=>`- **${l}**：${v}`).join('\n');
 return {id:s.id,title:s.title,category:s.category,order:index,created:'2026-09-22',modified:'2026-09-22',revision:'test',body:`# ${s.title}\n\n${metadata}\n\n## 摘要\n\n${s.abstract}\n\n## 研究记录\n\n${s.findings.map(i=>`- ${i}`).join('\n')}\n\n## 参考来源\n\n[参考来源](${s.source})\n`};
}
const docs=content.records.map(sampleDoc);setDesktopDocuments(docs);
assert.deepEqual(records,content.records);
for(let lane=0;lane<5;lane++)assert.deepEqual(columnFiles(lane),content.records.flatMap((r,i)=>r.category===content.columns[lane]?[i]:[]));
for(let i=0;i<40;i++){assert.ok(fileLocation(i).slot>=0);assert.equal(displayCode(i),Number(docs[i].id.slice(2)));}
const edited={...docs[0],body:docs[0].body+'\nUser addition'};setDesktopDocuments([edited,...docs.slice(1)]);assert.equal(records[0].source,'');assert.match(records[0].abstract,/User addition/);
const extra={...docs[0],id:'550e8400-e29b-41d4-a716-446655440000',title:'Extra',category:'Custom',body:'# Custom body'};
setDesktopDocuments([...docs,extra]);let index=exhibitDocument(extra.id);assert.ok(index>=40);assert.equal(documentForRecord(index).body,extra.body);assert.equal(fileLocation(index).lane,5);assert.ok(Number.isFinite(displayCode(index)));setDesktopDocuments([...docs,extra]);assert.equal(documentForRecord(exhibitDocument(extra.id)).id,extra.id);
setDesktopDocuments([extra]);index=exhibitDocument(extra.id);assert.equal(documentForRecord(index).id,extra.id);assert.equal(documentForRecord(0),undefined);
setDesktopDocuments([]);assert.ok(records.length>=40);assert.equal(documentForRecord(0),undefined);assert.equal(exhibitDocument(extra.id),-1);
console.log('Desktop exhibit: original 40 identical, edited Markdown, full category columns, UUID, single document and empty library passed.');
