import assert from 'node:assert/strict';
import { createSearchIndex, findTextRanges, highlightText } from '../src/desktop-search.ts';

// These tests assert retrieval behavior and source offsets rather than a DOM
// snapshot. Reader highlighting must never edit a ProseMirror document.
const doc = (id, title, body, extra = {}) => ({
  id, title, body, category: '资料', categoryId: 'reference', revision: `revision-${id}`, ...extra,
});
const index = createSearchIndex();
const ids = (query, options) => index.search(query, options).map(hit => hit.id);
let count = 0;
function check(name, run) { run(); count++; console.log(`  PASS ${name}`); }

check('Chinese whole terms reject a single character or scattered bigrams', () => {
  index.update([
    doc('whole', '操作说明', '可以恢复误删文档。'),
    doc('half', '操作说明', '此处仅有恢复操作。'),
    doc('scattered', '操作说明', '恢复配置，并查看误删报告。'),
    doc('bigrams', '操作说明', '恢恢复复误误删删'),
  ]);
  assert.deepEqual(ids('恢复误删'), ['whole']);
  assert.deepEqual(ids('恢复 误删').sort(), ['bigrams', 'scattered', 'whole']);
});

check('Multiple keywords use AND and can span metadata and body', () => {
  index.update([
    doc('both', '恢复指南', '备份位于本地。'),
    doc('one', '恢复指南', '暂无副本。'),
    doc('category', '说明', '恢复已完成。', { category: '备份' }),
  ]);
  assert.deepEqual(ids('恢复 备份').sort(), ['both', 'category']);
  assert.deepEqual(ids('备份 恢复').sort(), ['both', 'category']);
});

check('Quoted phrases must be contiguous, while unquoted words may be separate', () => {
  index.update([
    doc('phrase', 'Notes', 'render recovery is ready'),
    doc('gap', 'Notes', 'render will start after recovery'),
    doc('unrelated', 'Notes', 'render only'),
  ]);
  assert.deepEqual(ids('"render recovery"'), ['phrase']);
  assert.deepEqual(ids('render recovery').sort(), ['gap', 'phrase']);
  assert.deepEqual(ids('“render recovery”'), ['phrase']);
});

check('Full-width and English case normalization preserve exact source ranges', () => {
  const body = '说明 ＲＥＣＯＶＥＲＹ Cache 完成';
  index.update([doc('unicode', 'Ｏｆｆｌｉｎｅ说明', body)]);
  assert.deepEqual(ids('offline recovery cache'), ['unicode']);
  const hit = index.search('RECOVERY')[0];
  assert.equal(body.slice(hit.bodyRanges[0].start, hit.bodyRanges[0].end), 'ＲＥＣＯＶＥＲＹ');
  assert.equal(hit.snippet.slice(hit.ranges[0].start, hit.ranges[0].end), 'ＲＥＣＯＶＥＲＹ');
});

check('Compatibility ligatures and decomposed accents map to original graphemes', () => {
  assert.deepEqual(findTextRanges('oﬃce', 'ffi'), [{ start: 1, end: 2 }]);
  assert.equal(highlightText('oﬃce', 'ffi'), 'o<mark>ﬃ</mark>ce');
  assert.deepEqual(findTextRanges('cafe\u0301 résumé', 'café'), [{ start: 0, end: 5 }]);
  assert.deepEqual(findTextRanges('AﬃB cafe\u0301Z', '"b café"'), [{ start: 2, end: 9 }]);
});

check('Astral characters do not corrupt UTF-16 text ranges', () => {
  const text = '🔬备份🗂️恢复';
  const ranges = findTextRanges(text, '备份 恢复');
  assert.deepEqual(ranges.map(range => text.slice(range.start, range.end)), ['备份', '恢复']);
});

check('Exact title and category matches outrank body matches', () => {
  index.update([
    doc('body', '操作说明', '备份 '.repeat(15)),
    doc('category', '操作说明', '此处是内容', { category: '备份' }),
    doc('title', '备份', '简单内容'),
  ]);
  assert.deepEqual(ids('备份'), ['title', 'category', 'body']);
});

check('Exact contiguous phrases outrank separated keyword matches', () => {
  index.update([
    doc('exact', 'Notes', 'restore cache'),
    doc('separated', 'restore mechanism for cache', 'restore cache'.repeat(0)),
  ]);
  assert.equal(ids('restore cache')[0], 'exact');
});

check('Long-document snippets find a late match with surrounding context', () => {
  const body = '很长的无关内容。\n'.repeat(1600) + '\n实际操作：恢复误删记录后检查备份完整性。\n结束。';
  index.update([doc('long', '操作说明', body)]);
  const hit = index.search('恢复误删')[0];
  assert.ok(hit.snippet.includes('实际操作')); assert.ok(hit.snippet.includes('恢复误删'));
  assert.ok(hit.snippet.length <= 194); assert.ok(hit.snippet.startsWith('…'));
  assert.equal(body.slice(hit.bodyRanges[0].start, hit.bodyRanges[0].end), '恢复误删');
  assert.equal(hit.snippet.slice(hit.ranges[0].start, hit.ranges[0].end), '恢复误删');
});

check('Highlight HTML escapes hostile text and keeps mark as the only markup', () => {
  const html = highlightText('<img src=x onerror="alert(1)"> & \'bad\'', 'img alert');
  assert.equal(html, '&lt;<mark>img</mark> src=x onerror=&quot;<mark>alert</mark>(1)&quot;&gt; &amp; &#39;bad&#39;');
  assert.equal(highlightText('<script>bad</script>', ''), '&lt;script&gt;bad&lt;/script&gt;');
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script'));
});

check('Updates reuse unchanged text but never trust revision alone', () => {
  const first = doc('cache', 'One', 'source content');
  assert.deepEqual(index.update([first]), { indexed: 1, reused: 0, removed: 1, total: 1 });
  assert.deepEqual(index.update([{ ...first }]), { indexed: 0, reused: 1, removed: 0, total: 1 });
  assert.deepEqual(index.update([{ ...first, revision: 'new-revision', categoryId: null }]), { indexed: 0, reused: 1, removed: 0, total: 1 });
  const refreshed = index.search('source', { categoryId: null })[0];
  assert.equal(refreshed.revision, 'new-revision');
  assert.deepEqual(index.update([{ ...first, body: 'new content' }]), { indexed: 1, reused: 0, removed: 0, total: 1 });
  assert.deepEqual(ids('source'), []); assert.deepEqual(ids('new'), ['cache']);
  // Mutating a caller's object cannot silently mutate the cached snapshot.
  first.title = 'Changed title';
  index.update([first]); assert.deepEqual(ids('Changed'), ['cache']);
});

check('Deleted documents and stale postings disappear after a refresh', () => {
  index.update([doc('a', 'Alpha', 'needle'), doc('b', 'Beta', 'other')]);
  index.update([doc('b', 'Beta', 'other')]);
  assert.deepEqual(ids('needle'), []);
  assert.deepEqual(index.update([]), { indexed: 0, reused: 0, removed: 1, total: 0 });
  assert.deepEqual(ids(''), []);
});

check('Category null, stable IDs and empty scopes have distinct meaning', () => {
  index.update([
    doc('a', '说明', 'needle', { categoryId: 'a' }),
    doc('b', '说明', 'needle', { categoryId: 'b' }),
    doc('none', '说明', 'needle', { categoryId: null }),
  ]);
  assert.deepEqual(ids('needle', { categoryId: 'a' }), ['a']);
  assert.deepEqual(ids('needle', { categoryId: null }), ['none']);
  assert.deepEqual(ids('needle', { scopeIds: ['b'] }), ['b']);
  assert.deepEqual(ids('needle', { scopeIds: [] }), []);
  assert.deepEqual(ids('needle', { categoryId: 'a', scopeIds: ['b'] }), []);
});

check('Old literal substring searches still work for symbols, paths and substrings', () => {
  const documents = [
    doc('legacy', 'C++ Archive', 'recovery docs/path.md\nline two'),
    doc('literal', 'Other', 'version v1.2.0 is available'),
  ];
  index.update(documents);
  for (const query of ['C++', 'cover', 'docs/path.md', 'v1.2.0', 'line two', 'Archive\n资料', 'two']) {
    const previous = documents.filter(document => `${document.title}\n${document.category}\n${document.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(document => document.id);
    assert.ok(previous.every(id => ids(query).includes(id)), `lost previous literal query ${query}`);
  }
});

check('Blank documents, empty queries and deterministic ties are supported', () => {
  index.update([doc('b', 'Blank', ''), doc('a', 'Blank', '')]);
  const hits = index.search('Blank');
  assert.deepEqual(hits.map(hit => hit.id), ['a', 'b']);
  assert.equal(hits[0].snippet, 'Blank'); assert.deepEqual(hits[0].ranges, [{ start: 0, end: 5 }]);
  assert.deepEqual(index.search('   ').map(hit => hit.id), ['a', 'b']);
  index.update([{ id: 'minimum', title: 'Minimum', body: '' }]);
  assert.equal(index.search('Minimum')[0].categoryId, null);
});

console.log(`Desktop offline search: ${count} behavior checks passed.`);
