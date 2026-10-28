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
  }
  state.pos = end + 2;
  return true;
});

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
