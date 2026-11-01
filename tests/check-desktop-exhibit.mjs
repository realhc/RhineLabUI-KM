import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {records,setDesktopDocuments,columnFiles,fileLocation,exhibitDocument,documentForRecord} from '../src/desktop-data.ts';
const seed=JSON.parse(readFileSync('content/archives.json','utf8'));const docs=seed.records.map((s,i)=>({...s,body:s.body,order:i,created:'2026-11-01',modified:'2026-11-01',revision:'test'}));
setDesktopDocuments(docs);assert.equal(records.length,40);for(let lane=0;lane<5;lane++)assert.equal(columnFiles(lane).length,8);assert.equal(new Set(records.map((_,i)=>fileLocation(i).slot)).size,40);
const slots=Object.fromEntries(docs.map(d=>[d.id,fileLocation(exhibitDocument(d.id)).slot]));setDesktopDocuments([...docs].reverse());for(const d of docs)assert.equal(fileLocation(exhibitDocument(d.id)).slot,slots[d.id]);
for(const d of docs)assert.equal(documentForRecord(exhibitDocument(d.id)).body,d.body);
setDesktopDocuments([]);assert.equal(records.length,40);assert(records.every(r=>r.placeholder));
console.log('Onboarding is independent of forty fixed exhibit slots; identity, layout and empty library passed.');
