import assert from "node:assert/strict";
import { test } from "node:test";
import { compareHistory } from "../src/desktop-history-diff.ts";

function reconstruct(lines, side) {
  return lines.filter(row => row.kind !== (side === "current" ? "added" : "removed")).map(row => row.text).join("\n");
}

test("small comparisons reconstruct both versions including repeated and empty lines", () => {
  for (const [current, historical] of [
    ["标题\n原文\n", "标题\n修改\n补充\n"],
    ["", "新内容"], ["当前内容", ""],
    ["甲\n甲\n乙\n\n尾", "甲\n乙\n甲\n\n尾\n"],
    ["# 同标题\n\n旧段落\n\n末尾", "# 同标题\n\n新段落\n\n末尾"],
  ]) {
    const result = compareHistory(current, historical);
    assert.equal(result.truncated, false);
    assert.equal(reconstruct(result.lines, "current"), current);
    assert.equal(reconstruct(result.lines, "historical"), historical);
  }
});

test("identical notes and CRLF-only differences are empty", () => {
  assert.deepEqual(compareHistory("第一行\r\n第二行\r\n", "第一行\n第二行\n"), { lines: [], truncated: false });
  assert.deepEqual(compareHistory("", ""), { lines: [], truncated: false });
  const long = "重复\n".repeat(5000);
  assert.deepEqual(compareHistory(long, long), { lines: [], truncated: false });
});

test("the condensed view locates a change beyond the initial bounded line scan", () => {
  const prefix = Array.from({ length: 5000 }, (_, i) => "记录 " + i).join("\n") + "\n";
  const suffix = "\n结论\n附件\n最后\n";
  const result = compareHistory(prefix + "当前观察" + suffix, prefix + "历史观察" + suffix);
  assert(result.lines.some(row => row.kind === "removed" && row.text === "当前观察"));
  assert(result.lines.some(row => row.kind === "added" && row.text === "历史观察"));
  assert(result.lines.some(row => row.kind === "same" && row.text === "记录 4999"));
  assert(result.lines.length < 15);
  assert.equal(result.truncated, false);
});

test("large insertions and deletions show both sides rather than exhausting the view on removals", () => {
  const current = "当前内容\n".repeat(6000), historical = "历史内容\n".repeat(6000);
  const result = compareHistory(current, historical);
  assert(result.lines.length <= 3000);
  assert(result.lines.some(row => row.kind === "removed" && row.text === "当前内容"));
  assert(result.lines.some(row => row.kind === "added" && row.text === "历史内容"));
  assert.equal(result.truncated, true);
});

test("a multi-megabyte line is bounded for browser rendering and marked as truncated", () => {
  const middle = "长".repeat(2 * 1024 * 1024);
  const result = compareHistory("当前开头" + middle + "当前末尾", "历史开头" + middle + "历史末尾");
  assert.equal(result.truncated, true);
  assert(result.lines.every(row => row.text.length <= 4096));
  assert(result.lines.find(row => row.kind === "removed").text.endsWith("当前末尾"));
  assert(result.lines.find(row => row.kind === "added").text.startsWith("历史开头"));
});

test("many lengthy changed lines respect the total displayed-text budget", () => {
  const current = ("当前" + "甲".repeat(1000) + "\n").repeat(2000);
  const historical = ("历史" + "乙".repeat(1000) + "\n").repeat(2000);
  const result = compareHistory(current, historical);
  assert.equal(result.truncated, true);
  assert(result.lines.length <= 3000);
  assert(result.lines.reduce((sum, row) => sum + row.text.length, 0) <= 256 * 1024);
});

test("millions of short lines remain bounded while a final changed line remains visible", () => {
  const prefix = "\n".repeat(2 * 1024 * 1024);
  const result = compareHistory(prefix + "当前末尾", prefix + "历史末尾");
  assert(result.lines.length < 10);
  assert(result.lines.some(row => row.kind === "removed" && row.text === "当前末尾"));
  assert(result.lines.some(row => row.kind === "added" && row.text === "历史末尾"));
  assert.equal(result.truncated, false);
});
