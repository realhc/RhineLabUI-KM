/**
 * Offline lexical search shared by the reader and the optional AI tools.
 * Markdown remains the source of truth: this index is disposable and has no I/O,
 * model, renderer or repository dependencies. Updating it never changes a file.
 *
 * const index = createSearchIndex();
 * index.update(repositoryDocuments);
 * const hits = index.search('恢复 备份', { categoryId: selectedCategory });
 * Render snippets as text; `ranges` are UTF-16 offsets in that snippet. Use
 * `bodyRanges` / findTextRanges() with CSS Highlights, not DOM replacements in
 * the rich editor, so searching cannot enter its undo history.
 */
export interface SearchDocument {
  id: string;
  title: string;
  category?: string;
  categoryId?: string | null;
  body: string;
  revision?: string;
}

export interface SearchRange {
  start: number;
  end: number;
}

export interface SearchOptions {
  /** Omitted: every category. Explicit null: uncategorized documents only. */
  categoryId?: string | null;
  /** Restrict to a caller's visible documents, e.g. favorites or trash. */
  scopeIds?: readonly string[];
}

export interface SearchHit {
  id: string;
  title: string;
  categoryId: string | null;
  revision?: string;
  score: number;
  snippet: string;
  ranges: SearchRange[];
  bodyRanges: SearchRange[];
  matchedTerms: string[];
}

interface OffsetChange {
  normalizedStart: number;
  normalizedEnd: number;
  originalStart: number;
  originalEnd: number;
}

interface NormalizedField {
  text: string;
  changes: OffsetChange[];
}

interface IndexedDocument {
  document: SearchDocument;
  title: NormalizedField;
  category: NormalizedField;
  body: NormalizedField;
  combined: string;
  grams: Set<string>;
}

interface QueryPlan {
  literal: string;
  phrase: string;
  terms: string[];
}

// NFKC covers full-width input and compatibility ligatures. Grapheme mapping
// keeps original offsets correct when normalization expands or composes text.
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const normalize = (text: string) => text.normalize('NFKC').toLowerCase();

function normalizeField(original: string): NormalizedField {
  const chunks: string[] = [];
  const changes: OffsetChange[] = [];
  let offset = 0;
  for (const { segment, index } of segmenter.segment(original)) {
    const value = normalize(segment);
    chunks.push(value);
    if (value.length !== segment.length || (segment.length > 1 && value !== segment)) {
      changes.push({
        normalizedStart: offset,
        normalizedEnd: offset + value.length,
        originalStart: index,
        originalEnd: index + segment.length,
      });
    }
    offset += value.length;
  }
  return { text: chunks.join(''), changes };
}

function originalBoundary(field: NormalizedField, index: number, end: boolean) {
  const unit = end ? index - 1 : index;
  let low = 0;
  let high = field.changes.length - 1;
  let preceding = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (field.changes[middle].normalizedStart <= unit) {
      preceding = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const change = field.changes[preceding];
  if (!change) return index;
  if (unit < change.normalizedEnd)
    return end ? change.originalEnd : change.originalStart;
  return index + change.originalEnd - change.normalizedEnd;
}

function queryPlan(query: string): QueryPlan {
  const literal = normalize(query).trim();
  const terms: string[] = [];
  // Quoted text is contiguous. Unquoted whitespace / prose punctuation means
  // AND across terms; code symbols (C++, paths, dotted IDs) stay intact.
  const pattern = /"([^"]*)"|“([^”]*)”|「([^」]*)」|(\S+)/gu;
  for (const match of literal.matchAll(pattern)) {
    const quoted = match[1] ?? match[2] ?? match[3];
    const parts = quoted !== undefined
      ? [quoted.trim()]
      : match[4].split(/[,，、;；!?！？]+/u);
    for (const part of parts) if (part && !terms.includes(part)) terms.push(part);
  }
  if (!terms.length && literal) terms.push(literal);
  return { literal, phrase: terms.join(' '), terms };
}

function bigrams(text: string) {
  const values = new Set<string>();
  let previous = '';
  for (const character of text) {
    if (previous) values.add(previous + character);
    previous = character;
  }
  return values;
}

function occurrenceRanges(field: NormalizedField, terms: readonly string[], limit = 256) {
  const ranges: SearchRange[] = [];
  for (const term of terms) {
    let offset = 0;
    let count = 0;
    while (term && count < limit) {
      const start = field.text.indexOf(term, offset);
      if (start < 0) break;
      ranges.push({
        start: originalBoundary(field, start, false),
        end: originalBoundary(field, start + term.length, true),
      });
      offset = start + Math.max(1, term.length);
      count++;
    }
  }
  return mergeRanges(ranges);
}

function mergeRanges(ranges: SearchRange[]) {
  const sorted = ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const result: SearchRange[] = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else result.push({ ...range });
  }
  return result;
}

function frequency(text: string, term: string) {
  let count = 0;
  let offset = 0;
  while (count < 24) {
    const found = text.indexOf(term, offset);
    if (found < 0) return count;
    count++;
    offset = found + term.length;
  }
  return count;
}

function snippetFor(document: IndexedDocument, bodyRanges: SearchRange[], terms: string[]) {
  const body = document.document.body;
  const maxLength = 190;
  let anchor = bodyRanges[0]?.start ?? 0;
  let greatestCount = -1;
  // Favor the densest nearby matches instead of showing a long document's first
  // 190 characters. Bound the work independently of a repeated term's frequency.
  for (const candidate of bodyRanges.slice(0, 64)) {
    const count = bodyRanges.filter(range => range.start >= candidate.start && range.start < candidate.start + maxLength).length;
    if (count > greatestCount) { greatestCount = count; anchor = candidate.start; }
  }
  let start = Math.max(0, anchor - 54);
  let end = Math.min(body.length, start + maxLength);
  if (end === body.length) start = Math.max(0, end - maxLength);
  // Never clip a surrogate pair. Offsets exposed to the UI are UTF-16, like DOM.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(body[start])) start--;
  if (end < body.length && /[\uDC00-\uDFFF]/u.test(body[end])) end++;
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  const snippet = prefix + body.slice(start, end).replace(/\s/gu, ' ') + suffix;
  const ranges = bodyRanges
    .filter(range => range.end > start && range.start < end)
    .map(range => ({ start: Math.max(start, range.start) - start + prefix.length, end: Math.min(end, range.end) - start + prefix.length }));
  // Metadata-only hits still get a useful excerpt; empty documents show title.
  if (!snippet.trim()) {
    const fallback = document.document.title;
    return { snippet: fallback, ranges: findTextRanges(fallback, terms.join(' ')) };
  }
  return { snippet, ranges };
}

/** Original-text ranges; callers may use these with DOM Range / CSS Highlights. */
export function findTextRanges(text: string, query: string): SearchRange[] {
  const plan = queryPlan(query);
  if (!plan.terms.length) return [];
  return occurrenceRanges(normalizeField(text), plan.terms);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/gu, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

/** Safe HTML for plain-text snippets only; never apply it to editor markup. */
export function highlightText(text: string, query: string): string {
  const ranges = findTextRanges(text, query);
  let html = '';
  let position = 0;
  for (const range of ranges) {
    html += escapeHtml(text.slice(position, range.start));
    html += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    position = range.end;
  }
  return html + escapeHtml(text.slice(position));
}

export function createSearchIndex() {
  const documents = new Map<string, IndexedDocument>();
  const postings = new Map<string, Set<string>>();
  let averageBodyLength = 1;

  function remove(document: IndexedDocument) {
    for (const gram of document.grams) {
      const ids = postings.get(gram);
      ids?.delete(document.document.id);
      if (!ids?.size) postings.delete(gram);
    }
    documents.delete(document.document.id);
  }

  function update(source: readonly SearchDocument[]) {
    const present = new Set(source.map(document => document.id));
    let indexed = 0;
    let reused = 0;
    let removed = 0;
    for (const [id, previous] of documents) {
      if (!present.has(id)) { remove(previous); removed++; }
    }
    for (const document of source) {
      const previous = documents.get(document.id);
      // Revision alone cannot guarantee cache correctness: callers can change
      // metadata/body before a save. Compare actual content as well as revision.
      if (previous && previous.document.title === document.title &&
        previous.document.category === document.category &&
        previous.document.body === document.body) {
        // Revision/category ID may change without changing searchable text;
        // refresh the public snapshot while retaining normalized fields.
        previous.document = { ...document };
        reused++;
        continue;
      }
      if (previous) remove(previous);
      const title = previous?.document.title === document.title ? previous.title : normalizeField(document.title);
      const category = previous && previous.document.category === document.category ? previous.category : normalizeField(document.category ?? '');
      const body = previous?.document.body === document.body ? previous.body : normalizeField(document.body);
      const combined = `${title.text}\n${category.text}\n${body.text}`;
      const entry: IndexedDocument = { document: { ...document }, title, category, body, combined, grams: bigrams(combined) };
      documents.set(document.id, entry);
      for (const gram of entry.grams) {
        let ids = postings.get(gram);
        if (!ids) { ids = new Set(); postings.set(gram, ids); }
        ids.add(document.id);
      }
      indexed++;
    }
    averageBodyLength = Math.max(1, [...documents.values()].reduce((length, document) => length + document.body.text.length, 0) / Math.max(1, documents.size));
    return { indexed, reused, removed, total: documents.size };
  }

  function search(query: string, options: SearchOptions = {}): SearchHit[] {
    const plan = queryPlan(query);
    const scope = options.scopeIds ? new Set(options.scopeIds) : null;
    // Bigrams only narrow candidates. A whole term / phrase is verified below,
    // so a Chinese query cannot match merely one character or half of a word.
    const gramLists = [...new Set(plan.terms.flatMap(term => [...bigrams(term)]))]
      .map(gram => postings.get(gram) ?? new Set<string>())
      .sort((a, b) => a.size - b.size);
    const candidates = gramLists.length ? [...gramLists[0]] : [...documents.keys()];
    const matches: IndexedDocument[] = [];
    for (const id of candidates) {
      if (scope && !scope.has(id)) continue;
      const document = documents.get(id)!;
      if (options.categoryId !== undefined && (document.document.categoryId ?? null) !== options.categoryId) continue;
      if (!gramLists.every(ids => ids.has(id))) continue;
      if (!plan.terms.every(term => document.combined.includes(term)) &&
        !(plan.literal && document.combined.includes(plan.literal))) continue;
      matches.push(document);
    }
    const idfs = plan.terms.map(term => {
      const count = matches.filter(document => document.combined.includes(term)).length;
      return Math.log(1 + (documents.size - count + 0.5) / (count + 0.5));
    });
    return matches.map(document => {
      const exact = plan.phrase || plan.literal;
      const exactTier = !exact ? 0
        : document.title.text.includes(exact) ? 3
        : document.category.text.includes(exact) ? 2
        : document.body.text.includes(exact) || document.combined.includes(plan.literal) ? 1 : 0;
      let score = 0;
      if (plan.literal && document.combined.includes(plan.literal)) score += 100;
      plan.terms.forEach((term, index) => {
        const titleFrequency = frequency(document.title.text, term);
        const categoryFrequency = frequency(document.category.text, term);
        const bodyFrequency = frequency(document.body.text, term);
        const lengthPenalty = 1.2 * (0.25 + 0.75 * document.body.text.length / averageBodyLength);
        score += idfs[index] * (12 * titleFrequency + 6 * categoryFrequency +
          (bodyFrequency ? 2.2 * bodyFrequency / (bodyFrequency + lengthPenalty) : 0));
      });
      // Rank exact literal/phrase tiers before keyword frequency. Repeating a
      // keyword hundreds of times must not overtake an exact result.
      score = exactTier * 1_000_000 + Math.min(999_999, score);
      const bodyRanges = occurrenceRanges(document.body, plan.terms);
      const { snippet, ranges } = snippetFor(document, bodyRanges, plan.terms);
      return {
        id: document.document.id,
        title: document.document.title,
        categoryId: document.document.categoryId ?? null,
        revision: document.document.revision,
        score,
        snippet,
        ranges,
        bodyRanges,
        matchedTerms: plan.terms.filter(term => document.combined.includes(term)),
      };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  return { update, search };
}
