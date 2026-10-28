import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentGraph, createDocumentResolver, resolveDocumentReference } from "../src/desktop-graph-data.ts";

const doc = (id, title, body = "", category = "研究") => ({ id, title, body, category });
const ids = edges => edges.map(edge => [edge.source, edge.target]);

test("real internal references create directed, deduplicated edges and retain isolated documents", () => {
  const documents = [
    doc("a", "第一份", "[[第二份|别名]]\n\n[标注](b.md) [[第二份#部分]]"),
    doc("b", "第二份", "[回链](./a.md#细节)"),
    doc("orphan", "未连接"),
  ];
  const graph = buildDocumentGraph(documents);
  assert.deepEqual(graph.nodes, documents.map(({ id, title, category }) => ({ id, title, category })));
  assert.deepEqual(ids(graph.edges), [["a", "b"], ["b", "a"]]);
});

test("escaped text, images, embeds, code and external links are not relationships", () => {
  const body = String.raw`
\[[第二份]]  \[\[第二份\]\]  \[普通](b.md)
![图片](b.md) ![[第二份]]
Inline code: \`[[第二份]] [普通](b.md)\`

\`\`\`markdown
[[第二份]] [普通](b.md)
\`\`\`

    [[第二份]] [普通](b.md)

[网页](https://example.com/b.md) [邮件](mailto:b.md)
[绝对](/b.md) [父目录](../b.md) [外部](file:///b.md)
`;
  // Unescape only JavaScript's backticks, not Markdown's escaped brackets.
  const markdown = body.replaceAll("\\`", "`");
  const graph = buildDocumentGraph([doc("a", "第一份", markdown), doc("b", "第二份")]);
  assert.deepEqual(graph.edges, []);
});

test("aliases, fragments, percent encoding, reference definitions and Unicode resolve", () => {
  const documents = [
    doc("a", "来源", "[[Café#标题|别名]] [引用][r] [中文](%E4%B8%AD%E6%96%87.md#section)\n\n[r]: ./b.md \"提示\""),
    doc("b", "Cafe\u0301"),
    doc("c", "中文"),
  ];
  assert.deepEqual(ids(buildDocumentGraph(documents).edges), [["a", "b"], ["a", "c"]]);
  const resolve = createDocumentResolver(documents);
  assert.equal(resolve("b.md#段落"), "b");
  assert.equal(resolve("CAF%C3%89.md"), "b");
  assert.equal(resolve("./%E4%B8%AD%E6%96%87.md"), "c");
  assert.equal(resolveDocumentReference("中文", documents), "c");
});

test("ambiguous titles are never guessed; stable IDs remain unambiguous after a rename", () => {
  const documents = [doc("a", "来源", "[[同名]] [同名](同名.md) [精确](c.md)"), doc("b", "同名"), doc("c", "同名")];
  const resolve = createDocumentResolver(documents);
  assert.equal(resolve("同名"), undefined);
  assert.equal(resolve("同名.md"), undefined);
  assert.equal(resolve("c.md"), "c");
  assert.deepEqual(ids(buildDocumentGraph(documents).edges), [["a", "c"]]);
  documents[2].title = "已经改名";
  assert.equal(createDocumentResolver(documents)("c.md"), "c");
});

test("missing, self and unsafe destinations do not invent document edges", () => {
  const documents = [doc("a", "来源", "[[来源]] [[缺失]] [[#标题]] [自身](a.md#part) [不存在](missing.md)"), doc("b", "第二份")];
  const resolve = createDocumentResolver(documents);
  for (const ref of ["", "#part", "missing.md", "../b.md", "./../b.md", "%2E%2E%2Fb.md", "C:\\b.md", "https://example/b.md", "b.md?x", "%", "/b.md", "folder/b.md", "data:text/plain,b.md"]) {
    assert.equal(resolve(ref), undefined, ref);
  }
  assert.deepEqual(buildDocumentGraph(documents).edges, []);
});

test("empty libraries are valid and graph parsing does not modify input documents", () => {
  assert.deepEqual(buildDocumentGraph([]), { nodes: [], edges: [] });
  const documents = [Object.freeze(doc("a", "一篇", "[[二篇]]")), Object.freeze(doc("b", "二篇"))];
  const before = JSON.stringify(documents);
  buildDocumentGraph(Object.freeze(documents));
  assert.equal(JSON.stringify(documents), before);
});
