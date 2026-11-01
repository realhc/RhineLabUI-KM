import fs from "node:fs/promises";
const text = value => typeof value === "string" && value.trim().length > 0;
export function validateContent(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) throw new Error("档案数据必须是 JSON 对象。");
  for (const key of ["categories","columns"]) {
    if (!Array.isArray(content[key]) || content[key].length !== 5 || !content[key].every(text) || new Set(content[key]).size !== 5 || content[key].includes("全部档案")) throw new Error(key + " 必须包含五个不同的非空分类，不能使用全部档案。");
  }
  if (content.categories.some(name=>!content.columns.includes(name))) throw new Error("categories 与 columns 必须包含相同分类。");
  if (!Array.isArray(content.records) || content.records.length === 0 || content.records.length > 100) throw new Error("种子档案须包含 1 到 100 篇文档。");
  const ids=new Set();
  for (const [index,record] of content.records.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("种子档案必须是对象。");
    for (const key of ["id","title","category"]) if (!text(record[key])) throw new Error("records["+index+"]."+key+" 必须是非空文本。");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(record.id) || ids.has(record.id)) throw new Error("种子档案编号无效或重复。");
    ids.add(record.id);
    if (!content.categories.includes(record.category)) throw new Error("种子档案包含未知分类。");
    if (record.body !== undefined) { if (!text(record.body)) throw new Error("种子正文不能为空。"); }
    else if (!text(record.abstract) || !Array.isArray(record.findings) || !record.findings.every(text)) throw new Error("种子摘要和研究记录无效。");
    if (record.source) { try {const url=new URL(record.source);if(!["https:","http:"].includes(url.protocol))throw Error();}catch{throw new Error("种子来源必须是 HTTP 或 HTTPS 链接。");} }
  }
  return content;
}
export async function loadContent() { return validateContent(JSON.parse(await fs.readFile(new URL("../content/archives.json",import.meta.url),"utf8"))); }
