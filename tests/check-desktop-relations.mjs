import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentGraph, createRelationshipIndex, documentRelations, localDocumentGraph } from "../src/desktop-graph-data.ts";

const note = (id, title, body = "", category = "研究") => ({ id, title, body, category });
const ids = entries => entries.map(entry => entry.document.id);
const edges = graph => graph.edges.map(edge => [edge.source, edge.target]);

test("incoming and outgoing references retain paragraph context and deduplicate graph edges", () => {
  const documents = [
    note("a", "来源", "第一段 **重要** [证据](b.md) 和 [[目标|别名]]。\n\n第二段 [再次引用](b.md#章节)。\n\n[下一份](c.md)"),
    note("b", "目标", "[返回来源](a.md)"),
    note("c", "第三份"),
  ];
  const index = createRelationshipIndex(documents);
  const target = documentRelations(index, "b");
  assert.deepEqual(ids(target.incoming), ["a"]);
  assert.deepEqual(ids(target.outgoing), ["a"]);
  assert.equal(target.incoming[0].count, 2);
  assert.deepEqual(target.incoming[0].contexts, ["第一段 重要 证据 和 别名。", "第二段 再次引用。"]);
  assert.deepEqual(ids(documentRelations(index, "a").outgoing), ["b", "c"]);
  assert.deepEqual(index.graph, buildDocumentGraph(documents));
});

test("reference links, fragments and normalized Unicode produce the same saved relationship facts", () => {
  const documents = [
    note("a", "来源", "[[CAFÉ#章节|书目]] 与 [材料][ref]\n\n[ref]: ./b.md#section \"标题\""),
    note("b", "Cafe\u0301"),
  ];
  const index = createRelationshipIndex(documents);
  assert.deepEqual(edges(index.graph), [["a", "b"]]);
  assert.deepEqual(documentRelations(index, "b").incoming[0].contexts, ["书目 与 材料"]);
  assert.deepEqual(index.graph, buildDocumentGraph(documents));
});

test("unlinked mentions include readable marked text but exclude links, code, images, embeds and URLs", () => {
  const documents = [
    note("target", "目标"),
    note("plain", "普通文字", "我们需要检查**目标**的证据。\n\n另一段提及目标。"),
    note("links", "已链接", "[目标](target.md) [[目标]] [目标](https://example.com/目标) <https://example.com/目标>"),
    note("code", "代码", "`目标`\n\n```text\n目标 [[目标]]\n```\n\n    目标\n"),
    note("images", "图片", "![目标](target.md) ![[目标]] ![图片](../目标.png)"),
    note("urls", "地址", "https://example.com/目标\n\nmailto:目标@example.com\n"),
  ];
  const relations = documentRelations(createRelationshipIndex(documents), "target");
  assert.deepEqual(ids(relations.mentions), ["plain"]);
  assert.equal(relations.mentions[0].count, 2);
  assert.deepEqual(relations.mentions[0].contexts, ["我们需要检查目标的证据。", "另一段提及目标。"]);
  assert.deepEqual(ids(relations.incoming), ["links"]);
});

test("mentions cannot join across excluded inline content or match a Latin substring", () => {
  const documents = [
    note("target", "art"),
    note("valid", "真实提及", "ART, art! **art**"),
    note("word", "单词的一部分", "partial article cart art_works charts"),
    note("split", "被代码隔开", "ar`hidden`t ar![hidden](x.png)t ar[hidden](https://example.com)t"),
  ];
  const relations = documentRelations(createRelationshipIndex(documents), "target");
  assert.deepEqual(ids(relations.mentions), ["valid"]);
  assert.deepEqual(relations.incoming, []);
});

test("ambiguous titles own no mentions or title links while explicit IDs stay valid", () => {
  const documents = [
    note("a", "源", "同名值得阅读。 [[同名]] [同名](同名.md) [确切文档](c.md)"),
    note("b", "同名"), note("c", "同名"),
  ];
  const index = createRelationshipIndex(documents);
  assert.deepEqual(edges(index.graph), [["a", "c"]]);
  assert.deepEqual(documentRelations(index, "b").mentions, []);
  assert.deepEqual(documentRelations(index, "c").mentions, []);
  assert.deepEqual(ids(documentRelations(index, "c").incoming), ["a"]);
  const renamed = documents.map(doc => doc.id === "c" ? { ...doc, title: "新标题" } : doc);
  assert.deepEqual(ids(documentRelations(createRelationshipIndex(renamed), "c").incoming), ["a"]);
});

test("relation previews remain bounded and keep mention context around the actual occurrence", () => {
  const body = Array.from({ length: 8 }, (_, index) => `${"前文".repeat(150)}目标${index}${"后文".repeat(150)}`).join("\n\n");
  const relations = documentRelations(createRelationshipIndex([note("a", "来源", body), note("b", "目标")]), "b");
  const mention = relations.mentions[0];
  assert.equal(mention.count, 8);
  assert.equal(mention.contexts.length, 3);
  assert(mention.contexts.every(context => context.length <= 202 && context.includes("目标") && context.startsWith("…")));
});

test("one and two hop graphs traverse both directions and retain only induced edges", () => {
  const documents = [
    note("center", "中心", "[外链文档](out.md)"),
    note("in", "来源", "[中心](center.md)"),
    note("out", "去向", "[二层](two.md)"),
    note("two", "二层", "[三层](three.md)"),
    note("three", "三层"), note("island", "孤点"),
  ];
  const graph = createRelationshipIndex(documents).graph;
  const one = localDocumentGraph(graph, "center", 1), two = localDocumentGraph(graph, "center", 2);
  assert.deepEqual(one.nodes.map(node => node.id), ["center", "in", "out"]);
  assert.deepEqual(edges(one), [["center", "out"], ["in", "center"]]);
  assert.deepEqual(two.nodes.map(node => node.id), ["center", "in", "out", "two"]);
  assert.deepEqual(edges(two), [["center", "out"], ["in", "center"], ["out", "two"]]);
  assert.deepEqual(localDocumentGraph(graph, "island", 2).nodes.map(node => node.id), ["island"]);
  assert.deepEqual(localDocumentGraph(graph, "missing", 2), { nodes: [], edges: [] });
});

test("rebuilding a snapshot reflects removals, empty libraries and malformed graph edges without mutations", () => {
  const documents = Object.freeze([Object.freeze(note("a", "来源", "[[目标]]")), Object.freeze(note("b", "目标"))]);
  const before = JSON.stringify(documents);
  const index = createRelationshipIndex(documents);
  assert.equal(documentRelations(index, "b").incoming.length, 1);
  assert.deepEqual(documentRelations(createRelationshipIndex([documents[0]]), "b"), { incoming: [], outgoing: [], mentions: [] });
  assert.deepEqual(documentRelations(createRelationshipIndex([]), "b"), { incoming: [], outgoing: [], mentions: [] });
  const broken = { nodes: [{ id: "a", title: "A" }, { id: "b", title: "B" }], edges: [{ source: "a", target: "missing" }, { source: "missing", target: "b" }] };
  assert.deepEqual(localDocumentGraph(broken, "a", 2), { nodes: [broken.nodes[0]], edges: [] });
  assert.equal(JSON.stringify(documents), before);
});
