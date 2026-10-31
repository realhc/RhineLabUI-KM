import MarkdownIt from "markdown-it";

/** The graph is derived from active documents; it never writes to the library. */
export type GraphDocument = {
  id: string;
  title: string;
  body: string;
  category?: string;
};
export type GraphNode = { id: string; title: string; category?: string };
export type GraphEdge = { source: string; target: string };
export type DocumentGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

const keyForTitle = (title: string) => title.trim().normalize("NFC").toLowerCase();

/** Build once per document snapshot and reuse for all links in that snapshot. */
export function createDocumentResolver(documents: readonly GraphDocument[]) {
  const ids = new Set<string>();
  // null represents an ambiguous title: it must never resolve to an arbitrary document.
  const titles = new Map<string, string | null>();
  for (const document of documents) {
    ids.add(document.id);
    const key = keyForTitle(document.title);
    if (!key) continue;
    titles.set(key, titles.has(key) ? null : document.id);
  }
  return (reference: string): string | undefined => {
    if (typeof reference !== "string") return undefined;
    let name = reference.trim();
    // Link fragments refer to a section of the same target document.
    const fragment = name.indexOf("#");
    if (fragment >= 0) name = name.slice(0, fragment);
    try { name = decodeURIComponent(name); } catch { return undefined; }
    name = name.trim().normalize("NFC");
    if (!name || /^[a-z][a-z\d+.-]*:/i.test(name) || /[\\\u0000-\u001f?]/.test(name)) return undefined;
    if (name.startsWith("./")) name = name.slice(2);
    // Documents are a flat sibling collection; reject paths we cannot resolve safely.
    if (!name || name.includes("/") || name === "." || name === "..") return undefined;
    const withoutExtension = name.replace(/\.md$/i, "");
    if (!withoutExtension) return undefined;
    if (ids.has(withoutExtension)) return withoutExtension;
    return titles.get(keyForTitle(withoutExtension)) ?? undefined;
  };
}

export function resolveDocumentReference(reference: string, documents: readonly GraphDocument[]) {
  return createDocumentResolver(documents)(reference);
}

// Parse with the same Markdown grammar used by the reader. Unlike a regular
// expression over source text, inline rules respect escapes, images and code.
const markdown = new MarkdownIt({ html: false, linkify: false });
// Consume wiki embeds as a single ignored token, including for mention search.
markdown.inline.ruler.before("link", "rhine_wikiembed", (state, silent) => {
  const start = state.pos;
  if (!state.src.startsWith("![[", start)) return false;
  const end = state.src.indexOf("]]", start + 3);
  if (end < 0 || /[\r\n\[\]]/.test(state.src.slice(start + 3, end))) return false;
  if (!silent) state.push("rhine_wikiembed", "", 0);
  state.pos = end + 2;
  return true;
});
markdown.inline.ruler.before("link", "rhine_wikilink", (state, silent) => {
  const start = state.pos, source = state.src;
  if (source[start] !== "[" || source[start + 1] !== "[" || source[start - 1] === "!" || state.linkLevel > 0)
    return false;
  const end = source.indexOf("]]", start + 2);
  if (end < 0) return false;
  const content = source.slice(start + 2, end);
  if (!content || /[\r\n\[\]]/.test(content)) return false;
  if (!silent) {
    const token = state.push("rhine_wikilink", "", 0);
    token.content = content.split("|", 1)[0];
    token.meta = { label: content.includes("|") ? content.slice(content.indexOf("|") + 1) : token.content };
  }
  state.pos = end + 2;
  return true;
});

export type DocumentReference = { source: string; target: string; context: string };
type Passage = { context: string; plain: string };
export type RelationshipIndex = {
  graph: DocumentGraph;
  references: DocumentReference[];
  passages: Map<string, Passage[]>;
  titles: Map<string, number>;
};
export type RelatedDocument = { document: GraphNode; contexts: string[]; count: number };
export type DocumentRelations = { incoming: RelatedDocument[]; outgoing: RelatedDocument[]; mentions: RelatedDocument[] };

/** Parse a saved snapshot once. Context and mention text never execute as HTML. */
export function createRelationshipIndex(documents: readonly GraphDocument[]): RelationshipIndex {
  const graph: DocumentGraph = {
    nodes: documents.map(({ id, title, category }) => ({ id, title, ...(category !== undefined ? { category } : {}) })),
    edges: [],
  };
  const references: DocumentReference[] = [], passages = new Map<string, Passage[]>(), titles = new Map<string, number>();
  const resolve = createDocumentResolver(documents), seen = new Set<string>();
  for (const doc of documents) {
    const title = keyForTitle(doc.title);
    titles.set(title, (titles.get(title) || 0) + 1);
    const parsed: Passage[] = [];
    for (const block of markdown.parse(doc.body || "", {})) {
      if (block.type !== "inline" || !block.children) continue;
      const targets: string[] = [];
      let linkDepth = 0, plain = "", context = "";
      for (const token of block.children) {
        if (token.type === "link_open") {
          linkDepth++;
          plain += "\u0000";
          const reference = token.attrGet("href");
          const target = typeof reference === "string" ? resolve(reference) : undefined;
          if (target && target !== doc.id) targets.push(target);
        } else if (token.type === "link_close") {
          linkDepth = Math.max(0, linkDepth - 1);
          plain += "\u0000";
        } else if (token.type === "rhine_wikilink") {
          const target = resolve(token.content);
          if (target && target !== doc.id) targets.push(target);
          context += token.meta?.label || token.content;
          plain += "\u0000";
        } else if (token.type === "text") {
          context += token.content;
          if (!linkDepth) plain += token.content;
        } else if (token.type === "softbreak" || token.type === "hardbreak") {
          context += " "; plain += " ";
        } else if (["code_inline", "image", "rhine_wikiembed"].includes(token.type)) {
          plain += "\u0000"; context += " ";
        }
      }
      context = context.replace(/\s+/g, " ").trim();
      // Bare URLs are not prose mentions of a document title.
      plain = plain.replace(/(?:[a-z][a-z\d+.-]*:\/\/|mailto:)[^\s<>]+/gi, "\u0000").normalize("NFC").toLowerCase();
      if (plain.trim()) parsed.push({ context, plain });
      for (const target of new Set(targets)) {
        references.push({ source: doc.id, target, context });
        const key = doc.id + "\u0000" + target;
        if (!seen.has(key)) { seen.add(key); graph.edges.push({ source: doc.id, target }); }
      }
    }
    passages.set(doc.id, parsed);
  }
  return { graph, references, passages, titles };
}

function excerpt(text: string, focus = "") {
  if (text.length <= 200) return text;
  const at = focus ? text.normalize("NFC").toLowerCase().indexOf(keyForTitle(focus)) : -1;
  const start = Math.max(0, at - 60), end = Math.min(text.length, start + 200);
  return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export function documentRelations(index: RelationshipIndex, id: string): DocumentRelations {
  const byId = new Map(index.graph.nodes.map(node => [node.id, node]));
  const current = byId.get(id);
  if (!current) return { incoming: [], outgoing: [], mentions: [] };
  const incoming = new Map<string, RelatedDocument>(), outgoing = new Map<string, RelatedDocument>(), mentions = new Map<string, RelatedDocument>();
  function add(to: Map<string, RelatedDocument>, other: string, context: string, focus = "") {
    const document = byId.get(other);
    if (!document) return;
    const entry = to.get(other) || { document, contexts: [], count: 0 };
    entry.count++;
    const text = excerpt(context, focus);
    if (text && entry.contexts.length < 3 && !entry.contexts.includes(text)) entry.contexts.push(text);
    to.set(other, entry);
  }
  for (const ref of index.references) {
    if (ref.target === id) add(incoming, ref.source, ref.context, current.title);
    if (ref.source === id) add(outgoing, ref.target, ref.context, byId.get(ref.target)?.title);
  }
  const title = keyForTitle(current.title);
  // Two notes with the same title cannot safely own a plain-text mention.
  if (title && index.titles.get(title) === 1) for (const [source, passages] of index.passages) {
    if (source === id) continue;
    for (const passage of passages) {
      // Word boundaries avoid matching “art” inside “partial”; CJK titles keep substring matching.
      let start = passage.plain.indexOf(title);
      while (start >= 0) {
        const before = passage.plain[start - 1] || "", after = passage.plain[start + title.length] || "";
        if ((!/^[\p{L}\p{N}_]$/u.test(title[0]) || !/^[\p{L}\p{N}_]$/u.test(before) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title[0])) &&
            (!/^[\p{L}\p{N}_]$/u.test(title.at(-1)!) || !/^[\p{L}\p{N}_]$/u.test(after) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title.at(-1)!))) {
          add(mentions, source, passage.context, current.title); break;
        }
        start = passage.plain.indexOf(title, start + 1);
      }
    }
  }
  return { incoming: [...incoming.values()], outgoing: [...outgoing.values()], mentions: [...mentions.values()] };
}

/** Neighbourhood uses both directions. Stored links retain their direction. */
export function localDocumentGraph(graph: DocumentGraph, center: string, depth: 1 | 2 = 1): DocumentGraph {
  if (!graph.nodes.some(node => node.id === center)) return { nodes: [], edges: [] };
  const known = new Set(graph.nodes.map(node => node.id));
  const adjacent = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    for (const [a, b] of [[edge.source, edge.target], [edge.target, edge.source]]) {
      let peers = adjacent.get(a);
      if (!peers) adjacent.set(a, peers = new Set());
      peers.add(b);
    }
  }
  const included = new Set([center]);
  let frontier = [center];
  for (let hop = 0; hop < (depth === 2 ? 2 : 1); hop++) {
    const next: string[] = [];
    for (const id of frontier) for (const peer of adjacent.get(id) || []) {
      if (!included.has(peer)) { included.add(peer); next.push(peer); }
    }
    frontier = next;
  }
  return { nodes: graph.nodes.filter(node => included.has(node.id)), edges: graph.edges.filter(edge => included.has(edge.source) && included.has(edge.target)) };
}

export function buildDocumentGraph(documents: readonly GraphDocument[]): DocumentGraph {
  const nodes = documents.map(({ id, title, category }) => ({
    id, title, ...(category !== undefined ? { category } : {}),
  }));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const resolve = createDocumentResolver(documents);
  for (const document of documents) {
    if (!document.body) continue;
    for (const block of markdown.parse(document.body, {})) {
      if (block.type !== "inline" || !block.children) continue;
      for (const token of block.children) {
        const reference = token.type === "link_open" ? token.attrGet("href") :
          token.type === "rhine_wikilink" ? token.content : undefined;
        if (typeof reference !== "string") continue;
        const target = resolve(reference);
        if (!target || target === document.id) continue;
        const edgeKey = document.id + "\u0000" + target;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        edges.push({ source: document.id, target });
      }
    }
  }
  return { nodes, edges };
}
