import assert from "node:assert/strict";
import {loadContent,validateContent} from "../scripts/archive-content.mjs";
import {escapeHtml} from "../src/html.ts";
const content=await loadContent();assert.equal(content.records.length,6);assert(content.records.every(r=>r.body.includes("##")));
for(const mutate of [c=>c.records[0].title="",c=>c.records[1].id=c.records[0].id,c=>c.records[0].category="unknown",c=>c.records[0].body="",c=>c.records[0].source="javascript:alert(1)",c=>c.categories[1]=c.categories[0],c=>c.records=[]]) {const invalid=structuredClone(content);mutate(invalid);assert.throws(()=>validateContent(invalid));}
const reordered=structuredClone(content);reordered.records.reverse();assert.equal(validateContent(reordered),reordered);
const ids=new Set(content.records.map(r=>r.id));for(const r of content.records)for(const match of r.body.matchAll(/\]\(([a-z0-9-]+)\.md\)/g))assert(ids.has(match[1]),match[1]);
assert.equal(escapeHtml('<A> & "B"'),"&lt;A&gt; &amp; &quot;B&quot;");
console.log("Six onboarding guides, valid links, safe metadata and independent document order passed.");
